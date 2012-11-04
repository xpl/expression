/* Copyright:		© 2012 by Vitaly Gordon (rocket.mind@gmail.com)
 * Licensed under:	MIT
 */

var debug = false

Life = _.extends (Viewport, {
	init: function () {
		_.extend (this, {
			/* shaders */
			randomNoiseShader: this.shaderProgram ({
				vertex: 'cell-vs',
				fragment: 'cell-random-noise-fs',
				attributes: ['position'],
				uniforms: ['seed']
			}),
			updateFromBitmapShader: this.shaderProgram ({
				vertex: 'cell-vs',
				fragment: 'cell-update-from-bitmap-fs',
				attributes: ['position'],
				uniforms: ['source']
			}),
			iterationShader: this.shaderProgram ({
				vertex: 'cell-vs-pixeloffset',
				fragment: 'cell-iteration-fs',
				attributes: ['position'],
				uniforms: ['previousStep', 'screenSpace', 'pixelOffset', 'rules', 'activeRules']
			}),
			parametricBrushShader: this.shaderProgram ({
				vertex: 'cell-vs-pixeloffset',
				fragment: 'cell-brush-fs',
				attributes: ['position'],
				uniforms: ['cells', 'rules', 'activeRules', 'brushPosition1', 'brushPosition2', 'brushSize', 'seed',
					'pixelSpace', 'screenSpace', 'pixelOffset', 'noise', 'fill', 'animate', 'hue']
			}),
			patternBrushShader: this.shaderProgram ({
				vertex: 'cell-vs-pixeloffset',
				fragment: 'cell-bake-brush-fs',
				attributes: ['position'],
				uniforms: ['brush', 'cells', 'rules', 'activeRules', 'origin', 'scale', 'color', 'screenSpace', 'pixelOffset', 'animate']
			}),
			copyBrushShader: this.shaderProgram ({
				vertex: 'cell-vs',
				fragment: 'cell-copy-brush-fs',
				attributes: ['position'],
				uniforms: ['source', 'origin', 'scale']
			}),
			drawCellsShader: this.shaderProgram ({
				vertex: 'simple-vs',
				fragment: 'draw-cells-fs',
				attributes: ['position'],
				uniforms: ['cells', 'transform']
			}),
			brushCursorShader: this.shaderProgram ({
				vertex: 'simple-vs',
				fragment: 'brush-selection-cursor-fs',
				attributes: ['position'],
				uniforms: ['color', 'transform']
			}),
			/* square mesh */
			square: this.vertexBuffer ({
				type: this.gl.TRIANGLE_STRIP,
				vertices: [
			         1.0,  1.0,  0.0,
			        -1.0,  1.0,  0.0,
			         1.0, -1.0,  0.0,
			        -1.0, -1.0,  0.0
		        ]
			}),
			/* rules */
			rulesBuffer: this.texture ({
				width: 16,
				height: 4,
				data: this.genRulesBufferData (this.rules = [
					0, 0, 1, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
					0, 0, 1, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
					0, 0, 1, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
					0, 0, 1, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0])
			}),
			/* buffers */
			cellBuffer: null, 												// current
			cellBuffer1: this.renderTexture ({ width: debug ? 512 : 1024, height: 512 }),	// back
			cellBuffer2: this.renderTexture ({ width: debug ? 512 : 1024, height: 512 }),	// front
			brushBuffer: this.renderTexture ({ width: 16, height: 16 }),	// clone stamp
			/* transform matrices */
			transform: new Transform (),
			screenTransform: new Transform (),
			/* changeable parameters */
			scrollSpeed: 0.0,
			brushSize: 16.0,
			patternBrushScale: 128.0,
			brushColor: 0.0,
			paused: false,
			brushType: 'noise',
			activeRules: 3,
			currentRuleset: 0,
			/* other stuff */
			firstFrame: true
		})
		this.cellBuffer = this.cellBuffer1
		this.fillWithNothing ()
		this.initUserInput ()
		this.initGUI ()
	},
	genRulesBufferData: function (input) {
		return new Uint8Array (_.flatten (_.map (input, function (i) {
			return i == 2 ? [0,255,0,0] : (i == 1 ? [0,0,0,0] : [255,0,0,0])
		})))
	},
	initUserInput: function () {
		var removePrompt = function () {
			$('.draw-prompt').remove ()
			$(document).unbind ('mousedown', removePrompt)
		}
		$(document).mousedown (removePrompt)
		$(this.canvas).mousewheel ($.proxy (this.onZoom, this))
		$(this.canvas).mousedown ($.proxy (function (e) {
			if (!e.button) {
				if (!this.isCloning) {
					this.onPaintStart (e)
				}
			} else {
				this.onDragStart (e)
			}
		}, this))
		$(this.canvas).bind ('contextmenu', function (e) {
			e.preventDefault ()
		})
		$(this.canvas).mousemove ($.proxy (function (e) {
			this.cloneStampPosition = this.eventPoint (e)
		}, this))
		$(window).keydown ($.proxy (function (e) {
			switch (e.keyCode) {
				case 18: /* alt */
					if (!this.isPainting) {
						this.onCloneStart (e);
					}
					break;
				case 78: /* n */ this.setBrushType ('noise'); break;
				case 32: /* space */ this.paused = !this.paused; break;
				case 27: /* esc */ this.reset ('nothing'); $('.controls .scroll-speed').slider ('value', this.scrollSpeed = 0); break;
			}
		}, this))
		$(window).resize ($.proxy (function () {
			var container = $('.viewport-container')
			var width = container.width (),
				height = container.height ()
			if (width >= this.cellBuffer.width && height >= this.cellBuffer.height) {
				this.resize (this.cellBuffer.width, this.cellBuffer.height)
			} else {
				this.resize (width, height)
			}
		}, this)).resize ()
	},
	hueToCSSColor: function (H) {
		var r = Math.max (0.0, Math.min (1.0, Math.abs (H * 6.0 - 3.0) - 1.0))
		var g = Math.max (0.0, Math.min (1.0, 2.0 - Math.abs (H * 6.0 - 2.0)))
		var b = Math.max (0.0, Math.min (1.0, 2.0 - Math.abs (H * 6.0 - 4.0)))
		return 'rgba(' + Math.round (r * 255) + ',' + Math.round (g * 255) + ',' + Math.round (b * 255) + ', 1.0)'
	},
	initGUI: function () {
		this
			.slider ('.controls .width', { min: 9, max: 11, value: 10 }, function (value) {
				this.resizeBuffers (Math.pow (2, value), this.cellBuffer.height)
			})
			.slider ('.controls .height', { min: 9, max: 11, value: 9 }, function (value) {
				this.resizeBuffers (this.cellBuffer.width, Math.pow (2, value))
			})
			.slider ('.controls .scroll-speed', { min: 0, max: 6, value: 1 }, function (value) {
				this.scrollSpeed = value*2
			})
			.slider ('.controls .brush-scale', { min: 0, max: 10, value: 4, step: 0.1 }, function (value, slider) {
				this.brushSize = Math.pow (2, value)
			})
			.slider ('.controls .pattern-brush-scale', { min: 2, max: 12, value: 8, step: 1 }, function (value, slider) {
				this.patternBrushScale = Math.pow (2, value)
			})
			.slider ('.controls .brush-color', { min: 0, max: 100, value: 0, step: 1 }, function (value, slider) {
				this.brushColor = value / 100.0;
				slider.find ('a').attr ('style', value > 0 ? 'background:' + this.hueToCSSColor (this.brushColor) + ' !important;' : '')
			})
		$('.reset')
			.click ($.proxy (function (e) {
				this.reset ($(e.target).attr ('data-reset-with'))
				$('.controls .scroll-speed').slider ('value', this.scrollSpeed = 0)
			}, this))
		$('.brush-type .btn')
			.click ($.proxy (function (e) {
				this.setBrushType ($(e.target).attr ('data-brush-type'))
			}, this))
		$('.btn-pause')
			.click ($.proxy (function (e) {
				this.paused = !this.paused
			}, this))
		$('.btn-scroll')
			.click ($.proxy (function (e) {
				this.enableScroll (!(this.scrollSpeed > 0.0))
			}, this))
		$('.btn')
			.tooltip ({
				placement: 'bottom',
				trigger: 'hover'
			})
		$('.brush-type .pattern').tooltip ('destroy').tooltip ({
			placement: 'bottom',
			trigger: 'click'
		})
		$('.btn-info').click (function () {
			$('.modal.info').modal ('show')
		})
		$('.btn-rules').click (function () {
			$('.rules-editor').toggle ()
		})
		$('.rules-editor')
			.append ('<h6>select</h6>')
			.append ($('<button class="btn preset multiple-rules-toggle btn-inverse">multiple rules: <strong>on</strong></button>')
				.click ($.proxy (function () {
					this.activeRules = this.activeRules > 0 ? 0 : 3;
					$('.multiple-rules-toggle').html ('multiple rules: ' + (this.activeRules > 0 ? '<strong>on</strong>' : 'off'))
					$('.ruleset-switch .btn').toggleClass ('disabled', !(this.activeRules > 0))
					$('.ruleset-1').click ()
				}, this)))
		var rulesetSwitch = $('<div class="btn-group ruleset-switch" data-toggle="buttons-radio">').appendTo ($('.rules-editor'))
		rulesetSwitch
			.append ($('<button class="btn btn-inverse ruleset-1 active">#1</button>').click ($.proxy (function () {
				this.setCurrentRuleset (0)
			}, this)))
			.append ($('<button class="btn btn-inverse">#2</button>').click ($.proxy (function () {
				this.setCurrentRuleset (1)
			}, this)))
			.append ($('<button class="btn btn-inverse">#3</button>').click ($.proxy (function () {
				this.setCurrentRuleset (2)
			}, this)))

		$('.rules-editor').append ('<h6>rules</h6>')
		for (var i = 0; i <= 8; i++) {
			$('.rules-editor').append (this.ruleUI (i))
		}
		$('.rules-editor')
			.append ('<h6>presets</h6>')
			.append ($('<button class="btn preset btn-inverse">Conway classic</button>').click ($.proxy (function () {
				this.setRules ([0, 0, 1, 2, 0, 0, 0, 0, 0])
			}, this)))
			.append ($('<button class="btn preset btn-inverse">default</button>').click ($.proxy (function () {
				this.setRules ([0, 0, 1, 2, 0, 0, 0, 1, 0])
			}, this)))
			.append ($('<button class="btn preset btn-inverse">breeder 2</button>').click ($.proxy (function () {
				this.setRules ([0, 0, 1, 2, 0, 0, 1, 1, 0])
			}, this)))
			.append ($('<button class="btn preset btn-inverse">thermal sensor</button>').click ($.proxy (function () {
				this.setRules ([1, 2, 2, 0, 0, 0, 0, 0, 1])
			}, this)))
	},
	setCurrentRuleset: function (i) {
		this.currentRuleset = i
		$('.rules-editor .rule').each ($.proxy (function (index, rule) {
			rule.updateUI (this.rules[i * 16 + index])
		}, this))
	},
	setRules: function (rules) {
		$('.rules-editor .rule').each ($.proxy (function (index, rule) {
			this.rules[this.currentRuleset * 16 + index] = rules[index]
			rule.updateUI (this.rules[this.currentRuleset * 16 + index])
		}, this))
		this.rulesBuffer.update (this.genRulesBufferData (this.rules))
	},
	ruleUI: function (at) {
		var rule = $('<div class="rule">').append ($('<span class="count">' + at + ':</span>'))
		var buttons = $('<div class="btn-group" data-toggle="buttons-radio">').appendTo (rule)
		var die, keep, born
		var updateUI = rule.get (0).updateUI = function (value) {
			die.attr ('class', 'btn ' + (value == 0 ? 'active btn-danger' : 'btn-inverse'))
			keep.attr ('class', 'btn ' + (value == 1 ? 'active btn-info' : 'btn-inverse'))
			born.attr ('class', 'btn ' + (value == 2 ? 'active btn-success' : 'btn-inverse'))
		}
		var commit = $.proxy (function (value) {
			this.rules[this.currentRuleset * 16 + at] = value
			this.rulesBuffer.update (this.genRulesBufferData (this.rules))
		}, this)
		die = $('<button class="btn">die</button>').click (function () { updateUI (0); commit (0); }).appendTo (buttons)
		keep = $('<button class="btn">keep</button>').click (function () { updateUI (1); commit (1); }).appendTo (buttons)
		born = $('<button class="btn">born</button>').click (function () { updateUI (2); commit (2); }).appendTo (buttons)
		updateUI (this.rules[at])
		return rule
	},
	enableScroll: function (enable) {
		this.scrollSpeed = enable ? 2.0 : 0.0
		$('.btn-scroll').toggleClass ('yes', enable)
	},
	slider: function (selector, cfg, handler) {
		var el = $(selector)
		el.slider (cfg)
			.bind ('slide', $.proxy (function (e, ui) {
				handler.call (this, ui.value, el)
				el.find ('.ui-slider-handle').blur () /* do not want focus */
			}, this))
			.bind ('change', $.proxy (function (e, ui) {
				/* FIXME: change event does not fire ?? */
				handler.call (this, ui.value, el)
			}, this))
		return this
	},
	setBrushType: function (type) {
		this.brushType = type
		$('.brush-type .btn').removeClass ('active')
		$('.brush-type .' + type).addClass ('active')
		$('.brush-settings').attr ('class', 'brush-settings ' + type)
		if (type != 'pattern') {
			$('.brush-type .pattern').tooltip ('hide')
		}
	},
	resizeBuffers: function (w, h) {
		this.cellBuffer1.resize (w, h)
		this.cellBuffer2.resize (w, h)
		$(window).resize ()
		this.reset ('nothing')
		this.updateTransform (new Transform ())
	},
	reset: function (type) {
		if (type == 'noise') {
			this.fillWithRandomNoise ()
		} else if (type == 'image') {
			$('.modal-overlay.loading').fadeIn (200)
			this.resizeBuffers (1024, 512)
			var image = new Image ();
  			image.onload = $.proxy (function () {
  				this.cellBuffer.updateFromImage (image)
  				this.cellBuffer.draw (function () {
					this.updateFromBitmapShader.use ()
					this.updateFromBitmapShader.attributes.position.bindBuffer (this.square)
					this.updateFromBitmapShader.uniforms.source.bindTexture (this.cellBuffer)
					this.square.draw ()
				}, this)
				$('.modal-overlay.loading').fadeOut (200)
  			}, this)
			image.src = 'van-gogh.jpg';
		} else {
			this.fillWithNothing ()
		}
	},
	eventPoint: function (e) {
		var offset = $(this.canvas).offset ()
		return [
			(e.clientX - offset.left) / (this.viewportWidth * 0.5) - 1.0,
			(offset.top - e.clientY) / (this.viewportHeight * 0.5) + 1.0, 0.0]
	},
	onZoom: function (e) {
		var zoom = Math.pow (1.03, e.originalEvent.wheelDelta ?
			(e.originalEvent.wheelDelta / (navigator.platform == 'MacIntel' ? 360.0 : 36.0)) : -e.originalEvent.detail)
		var origin = this.transform.applyInverse (this.eventPoint (e))
		this.updateTransform (this.transform.multiply (new Transform ()
			.translate (origin)
			.scale ([zoom, zoom, 1.0])
			.translate ([-origin[0], -origin[1], 0.0])))
	},
	getZoom: function () {
		return vec3.length (vec3.subtract (
				this.transform.apply ([0, 0, 0]),
				this.transform.apply ([1, 0, 0])))
	},
	onDragStart: function (e) {
		this.isDragging = true
		var origin = this.transform.applyInverse (this.eventPoint (e))
		$(window).mousemove ($.proxy (function (e) {
			var point = this.transform.applyInverse (this.eventPoint (e))
			this.updateTransform (this.transform.translate ([point[0] - origin[0], point[1] - origin[1], 0.0]))
		}, this))
		$(window).mouseup ($.proxy (function () {
			this.isDragging = false
			$(window).unbind ('mouseup')
			$(window).unbind ('mousemove')
		}, this))
	},
	onPaintStart: function (e) {
		this.paintFrom = this.paintTo = this.eventPoint (e)
		this.eraseMode = e.shiftKey
		this.shouldPaint = true
		this.isPainting = true
		this.parametricBrushShader.use ()
		this.parametricBrushShader.uniforms.hue.set1f (Math.random ())
		$(window).mousemove ($.proxy (function (e) {
			this.paintTo = this.eventPoint (e)
			this.eraseMode = e.shiftKey
			this.shouldPaint = true
		}, this))
		$(window).mouseup ($.proxy (function () {
			this.isPainting = false
			$(window).unbind ('mouseup')
			$(window).unbind ('mousemove')
		}, this))
	},
	onCloneStart: function (e) {
		$('.brush-type .pattern').tooltip ('hide')
		this.setBrushType ('pattern')
		this.isCloning = true
		this.brushBuffer.resize (this.patternBrushScale, this.patternBrushScale)
		$(window).mousemove ($.proxy (function (e) {
			this.cloneStampPosition = this.eventPoint (e)
		}, this))
		$(window).keyup ($.proxy (function () {
			this.isCloning = false
			$(window).unbind ('keyup')
			$(window).unbind ('mousemove')
		}, this))
	},
	fillWithRandomNoise: function () {
		this.cellBuffer.draw (function () {
			this.randomNoiseShader.use ()
			this.randomNoiseShader.attributes.position.bindBuffer (this.square)
			this.randomNoiseShader.uniforms.seed.set2f (Math.random (), Math.random ())
			this.square.draw ()
		}, this)
		this.firstFrame = true
	},
	fillWithNothing: function () {
		this.cellBuffer.draw (function () {
			this.gl.clearColor (0.0, 0.0, 0.0, 1.0)
			this.gl.clear (this.gl.COLOR_BUFFER_BIT)
		}, this)
	},
	springDynamics: function () {
		var zoom = this.getZoom ()
		if (!this.isDragging) {
			if (zoom > 0.99) {
				var center = this.transform.apply ([0, 0, 0])
				var springForce = [
					(Math.max (0, Math.abs(center[0]) - (zoom - 1))) / zoom,
					(Math.max (0, Math.abs(center[1]) - (zoom - 1))) / zoom]
				this.updateTransform (this.transform.translate ([
					(Math.pow (1.2, springForce[0]) - 1.0) * (center[0] > 0 ? -1 : 1),
					(Math.pow (1.2, springForce[1]) - 1.0) * (center[1] > 0 ? -1 : 1), 0.0]))
			} else {
				this.updateTransform (this.transform.translate (this.transform.applyInverse ([0, 0, 0])))
			}
		}
		if (zoom < 1.0) {
			var springForce = Math.pow (1.2, 1.0 - zoom)
			this.updateTransform (this.transform.scale ([springForce, springForce, 1.0]))
		}
	},
	updateTransform: function (newTransform) {
		var viewportTransform = new Transform ()
		var aspect = this.viewportWidth / this.viewportHeight
		var bufferAspect = this.cellBuffer.width / this.cellBuffer.height
		if (this.cellBuffer.width < this.viewportWidth && this.cellBuffer.height < this.viewportHeight) {
			viewportTransform = viewportTransform.scale ([
				this.cellBuffer.width / this.viewportWidth,
				this.cellBuffer.height / this.viewportHeight, 1.0])
		} else {
			viewportTransform = viewportTransform.scale (this.cellBuffer.width > this.cellBuffer.height
				? [1.0, aspect / bufferAspect, 1.0]
				: [bufferAspect / aspect, 1.0, 1.0])
		}
		this.transform = newTransform || this.transform
		this.screenTransform = this.transform.multiply (viewportTransform)
	},
	beforeDraw: function () {
		if (!this.paused) {
			if (this.shouldPaint) {
				this.paint (true)
			} else {
				this.iterate ()
			}
		} else if (this.shouldPaint) {
			this.paint (false)
		}
		if (this.isCloning) {
			this.updateBrushBuffer ()
		}
		this.springDynamics ()
	},
	renderCells: function (callback) {
		/* backbuffering */
		var targetBuffer = (this.cellBuffer == this.cellBuffer1 ? this.cellBuffer2 : this.cellBuffer1)
		targetBuffer.draw (callback, this)
		this.cellBuffer = targetBuffer
		this.firstFrame = false
	},
	iterate: function () {
		this.renderCells (function () {
			this.iterationShader.use ()
			this.iterationShader.attributes.position.bindBuffer (this.square)
			this.iterationShader.uniforms.previousStep.bindTexture (this.cellBuffer, 0)
			this.iterationShader.uniforms.rules.bindTexture (this.rulesBuffer, 1)
			this.iterationShader.uniforms.activeRules.set1f (this.activeRules * 1.0)
			this.iterationShader.uniforms.screenSpace.set2f (1.0 / this.cellBuffer.width, 1.0 / this.cellBuffer.height)
			this.iterationShader.uniforms.pixelOffset.set2f (
				0.0 / this.cellBuffer.width,
				-(0.5 + this.scrollSpeed * !this.firstFrame) / this.cellBuffer.height)
		    this.square.draw ()
		})
	},
	paint: function (animate) {
		if (this.brushType == 'pattern' && this.brushBufferReady) {
			this.paintBrushBuffer (animate)
		} else {
			this.paintParametricBrush (animate)
		}
		this.paintFrom = this.paintTo
		this.shouldPaint = false
	},
	paintBrushBuffer: function (animate) {
		this.renderCells (function () {
			this.patternBrushShader.use ()
			this.patternBrushShader.attributes.position.bindBuffer (this.square)
			this.patternBrushShader.uniforms.cells.bindTexture (this.cellBuffer, 0)
			this.patternBrushShader.uniforms.rules.bindTexture (this.rulesBuffer, 1)
			this.patternBrushShader.uniforms.activeRules.set1f (this.activeRules * 1.0)
			this.patternBrushShader.uniforms.brush.bindTexture (this.brushBuffer, 2)
			this.patternBrushShader.uniforms.pixelOffset.set2f (0.0,
				animate ? (-(0.5 + this.scrollSpeed * !this.firstFrame) / this.cellBuffer.height) : 0.0)
			this.patternBrushShader.uniforms.screenSpace.set2f (1.0 / this.cellBuffer.width, 1.0 / this.cellBuffer.height)
			this.patternBrushShader.uniforms.color.set3fv (this.eraseMode ? vec3.create ([0,0,0]) : vec3.create ([1,1,1]))
			this.patternBrushShader.uniforms.origin.set2fv (this.screenTransform.applyInverse (this.paintTo))
			this.patternBrushShader.uniforms.animate.set1i (animate ? 1 : 0)
			this.patternBrushShader.uniforms.scale.set2f (
				(this.brushBuffer.width / this.cellBuffer.width),
				(this.brushBuffer.height / this.cellBuffer.height))
			this.square.draw ()
		})
	},
	paintParametricBrush: function (animate) {
		this.renderCells (function () {
			var pixelSpace = new Transform ()
				.scale ([this.viewportWidth, this.viewportHeight, 1.0])
				.multiply (this.screenTransform)
			var texelSize =
				pixelSpace.apply ([0,0,0])[0] -
				pixelSpace.apply ([-1.0 / this.cellBuffer.width, 0, 0])[0]
			this.parametricBrushShader.use ()
			this.parametricBrushShader.attributes.position.bindBuffer (this.square)
			this.parametricBrushShader.uniforms.cells.bindTexture (this.cellBuffer, 0)
			this.parametricBrushShader.uniforms.rules.bindTexture (this.rulesBuffer, 1)
			this.parametricBrushShader.uniforms.activeRules.set1f (this.activeRules * 1.0)
			this.parametricBrushShader.uniforms.brushPosition1.set2fv (this.screenTransform.applyInverse (this.paintFrom))
			this.parametricBrushShader.uniforms.brushPosition2.set2fv (this.screenTransform.applyInverse (this.paintTo))
			this.parametricBrushShader.uniforms.pixelSpace.setMatrix (pixelSpace)
			this.parametricBrushShader.uniforms.pixelOffset.set2f (0.0,
				animate ? (-(0.5 + this.scrollSpeed * !this.firstFrame) / this.cellBuffer.height) : 0.0)
			this.parametricBrushShader.uniforms.screenSpace.set2f (1.0 / this.cellBuffer.width, 1.0 / this.cellBuffer.height)
			this.parametricBrushShader.uniforms.brushSize.set1f (Math.max (this.brushSize, texelSize))
			this.parametricBrushShader.uniforms.seed.set2f (Math.random (), Math.random ())
			this.parametricBrushShader.uniforms.noise.set1i (this.brushType == 'noise')
			this.parametricBrushShader.uniforms.fill.set1f (this.eraseMode ? 0.0 : 1.0)
			this.parametricBrushShader.uniforms.animate.set1i (animate ? 1 : 0)
			if (this.brushColor > 0.01) {
				this.parametricBrushShader.uniforms.hue.set1f (this.brushColor)
			}
		    this.square.draw ()
		})
	},
	updateBrushBuffer: function () {
		this.brushBuffer.draw (function () {
			this.copyBrushShader.use ()
			this.copyBrushShader.attributes.position.bindBuffer (this.square)
			this.copyBrushShader.uniforms.source.bindTexture (this.cellBuffer, 0)
			this.copyBrushShader.uniforms.origin.set2fv (this.screenTransform.applyInverse (this.cloneStampPosition))
			this.copyBrushShader.uniforms.scale.set2f (
				this.brushBuffer.width / this.cellBuffer.width,
				this.brushBuffer.height / this.cellBuffer.height)
		    this.square.draw ()
			this.brushBufferReady = true;
		}, this)
	},
	draw: function () {
		this.gl.disable (this.gl.DEPTH_TEST)
		this.gl.clear (this.gl.COLOR_BUFFER_BIT)
		this.drawCellsShader.use ()
		this.drawCellsShader.attributes.position.bindBuffer (this.square)
		this.drawCellsShader.uniforms.transform.setMatrix (this.screenTransform)
		this.drawCellsShader.uniforms.cells.bindTexture (this.cellBuffer, 0)
		this.square.draw ()
		this.drawCloneStamp ()
	},
	drawCloneStamp: function () {
		if (this.isCloning) {
			this.brushCursorShader.use ()
			this.brushCursorShader.attributes.position.bindBuffer (this.square)
			this.brushCursorShader.uniforms.transform.setMatrix (new Transform ()
				.translate (this.cloneStampPosition)
				.scale ([this.brushBuffer.width / this.cellBuffer.width, this.brushBuffer.height / this.cellBuffer.height, 0.0])
				.multiply (this.screenTransform))
			this.brushCursorShader.uniforms.color.bindTexture (this.brushBuffer, 0)
			this.square.draw ()
		}
	},
	noGL: function () {
		$('.no-webgl').modal ('show')
	}
})

$(document).ready (function () {
	var life = new Life ({
		canvas: $('.viewport').get (0)
	})
})