const h = React.createElement;
const App = () => h('html', null, h('head', null, h('title', null, 't')), h('body', null, h('div', { id: 'AdBar' }, 'AD'), h('p', { id: 'p' }, 'hi'), h('script', { src: '/r.js' }), h('script', { src: '/rd.js' }), h('script', { src: '/boot.js' })));
window.__errs = [];
ReactDOM.hydrateRoot(document, h(App), { onRecoverableError: (e) => window.__errs.push(String(e.message).slice(0, 120)) });
