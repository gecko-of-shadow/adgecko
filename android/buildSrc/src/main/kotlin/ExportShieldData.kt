import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import org.gradle.process.ExecOperations
import java.io.ByteArrayOutputStream
import javax.inject.Inject

/**
 * Runs scripts/export-android-data.mjs with Deno (docs/android/PLAN.md
 * section 4.4, owner approval OD-5). Deno gets read permission on the
 * repository and write permission on the output folder only. It gets no
 * network permission, so the build shows that it downloads nothing.
 *
 * The files go to <outputDir>/shield/ (the APK assets path "shield/"). With
 * [samples] = true the task also writes <outputDir>/samples.json for the JVM
 * parity tests of :shield-core.
 */
abstract class ExportShieldData : DefaultTask() {
    @get:Inject
    abstract val exec: ExecOperations

    /** The repository root: the folder that holds src/ and scripts/. */
    @get:Internal
    abstract val repoRoot: DirectoryProperty

    @get:InputFile
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val script: RegularFileProperty

    /** src/rules, src/threat, src/general, the licence files and the JS policy. */
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val sources: ConfigurableFileCollection

    @get:Input
    abstract val samples: Property<Boolean>

    /** "deno" on the PATH, or the Gradle property adgecko.deno. */
    @get:Input
    abstract val denoExecutable: Property<String>

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun export() {
        val root = repoRoot.get().asFile
        val out = outputDir.get().asFile
        val shieldDir = out.resolve("shield")
        shieldDir.mkdirs()
        val args = mutableListOf(
            "run", "--no-lock",
            "--allow-read=" + root.absolutePath,
            "--allow-write=" + out.absolutePath,
            script.get().asFile.absolutePath,
            "--out", shieldDir.absolutePath,
        )
        if (samples.get()) {
            args += listOf("--samples", out.resolve("samples.json").absolutePath)
        }
        val log = ByteArrayOutputStream()
        val result = try {
            exec.exec {
                executable = denoExecutable.get()
                args(args)
                workingDir = root
                standardOutput = log
                errorOutput = log
                isIgnoreExitValue = true
            }
        } catch (e: Exception) {
            throw GradleException(
                "ExportShieldData: cannot start Deno ('${denoExecutable.get()}'). " +
                    "Install Deno 2.9.8 and put it on the PATH, or set -Padgecko.deno=<path to deno>. " +
                    "Cause: ${e.message}",
                e,
            )
        }
        logger.lifecycle(log.toString(Charsets.UTF_8).trim())
        if (result.exitValue != 0) {
            throw GradleException("ExportShieldData: Deno exited with ${result.exitValue}.")
        }
        if (!shieldDir.resolve("shield-manifest.json").isFile) {
            throw GradleException("ExportShieldData: shield-manifest.json is missing after the export.")
        }
    }
}
