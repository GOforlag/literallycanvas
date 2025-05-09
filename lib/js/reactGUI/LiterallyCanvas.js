'use strict';

var React = require('../reactGUI/React-shim');
var createReactClass = require('../reactGUI/createReactClass-shim');

var _require = require('../reactGUI/ReactDOM-shim'),
    findDOMNode = _require.findDOMNode;

var _require2 = require('../core/util'),
    classSet = _require2.classSet;

var Picker = require('./Picker');
var Options = require('./Options');
var createToolButton = require('./createToolButton');
var LiterallyCanvasModel = require('../core/LiterallyCanvas');
var defaultOptions = require('../core/defaultOptions');

require('../optionsStyles/font');
require('../optionsStyles/stroke-width');
require('../optionsStyles/line-options-and-stroke-width');
require('../optionsStyles/polygon-and-stroke-width');
require('../optionsStyles/null');

var CanvasContainer = createReactClass({
  displayName: 'CanvasContainer',
  shouldComponentUpdate: function shouldComponentUpdate() {
    // Avoid React trying to control this DOM
    return false;
  },
  render: function render() {
    return React.createElement('div', { key: 'literallycanvas', className: 'lc-drawing with-gui' });
  }
});

var LiterallyCanvas = createReactClass({
  displayName: 'LiterallyCanvas',

  getDefaultProps: function getDefaultProps() {
    return defaultOptions;
  },
  bindToModel: function bindToModel() {
    var canvasContainerEl = findDOMNode(this.canvas);
    var opts = this.props;
    this.lc.bindToElement(canvasContainerEl);

    if (typeof this.lc.opts.onInit === 'function') {
      this.lc.opts.onInit(this.lc);
    }
  },
  UNSAFE_componentWillMount: function UNSAFE_componentWillMount() {
    var _this = this;

    if (this.lc) return;

    if (this.props.lc) {
      this.lc = this.props.lc;
    } else {
      this.lc = new LiterallyCanvasModel(this.props);
    }

    this.toolButtonComponents = this.lc.opts.tools.map(function (ToolClass) {
      return createToolButton(new ToolClass(_this.lc));
    });
  },
  componentDidMount: function componentDidMount() {
    if (!this.lc.isBound) {
      this.bindToModel();
    }
  },
  componentWillUnmount: function componentWillUnmount() {
    if (this.lc) {
      this.lc._teardown();
    }
  },
  render: function render() {
    var _this2 = this;

    var lc = this.lc,
        toolButtonComponents = this.toolButtonComponents,
        props = this.props;
    var _lc$opts = this.lc.opts,
        imageURLPrefix = _lc$opts.imageURLPrefix,
        toolbarPosition = _lc$opts.toolbarPosition,
        imageSize = _lc$opts.imageSize;


    var pickerProps = { lc: lc, toolButtonComponents: toolButtonComponents, imageURLPrefix: imageURLPrefix };
    var topOrBottomClassName = classSet({
      'toolbar-at-top': toolbarPosition === 'top',
      'toolbar-at-bottom': toolbarPosition === 'bottom',
      'toolbar-hidden': toolbarPosition === 'hidden'
    });

    var style = {};
    if (imageSize.height) style.height = imageSize.height;

    return React.createElement(
      'div',
      { className: 'literally ' + topOrBottomClassName, style: style },
      React.createElement(CanvasContainer, { ref: function ref(item) {
          return _this2.canvas = item;
        } }),
      React.createElement(Picker, pickerProps),
      React.createElement(Options, { lc: lc, imageURLPrefix: imageURLPrefix })
    );
  }
});

module.exports = LiterallyCanvas;