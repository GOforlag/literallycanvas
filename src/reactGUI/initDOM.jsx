const React = require('./React-shim');
const ReactDOM = require('./ReactDOM-shim');
const LiterallyCanvasModel = require('../core/LiterallyCanvas');
const LiterallyCanvasReactComponent = require('./LiterallyCanvas');

function init(el, opts) {
  const originalClassName = el.className
  const lc = new LiterallyCanvasModel(opts)

  // Use createRoot API for React 18+, fallback to render for older versions
  let root;
  if (ReactDOM.createRoot) {
    root = ReactDOM.createRoot(el);
    root.render(<LiterallyCanvasReactComponent lc={lc} />);
  } else {
    ReactDOM.render(<LiterallyCanvasReactComponent lc={lc} />, el);
  }

  lc.teardown = function() {
    lc._teardown();
    if (root && root.unmount) {
      root.unmount();
    } else {
      ReactDOM.unmountComponentAtNode(el);
    }
    el.className = originalClassName;
  };
  return lc;
}

module.exports = init;
