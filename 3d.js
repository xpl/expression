/* Copyright:		© 2012 by Vitaly Gordon (rocket.mind@gmail.com)
 * Licensed under:	MIT
 */

function domAPI (name) {
	return _.find (_.map (['', 'webkit', 'moz', 'o', 'ms'], function (prefix) {
		return window[prefix ? (prefix + name.charAt (0).toUpperCase () + name.slice (1)) : name]
	}), _.identity)
}

window.requestAnimationFrame = domAPI ('requestAnimationFrame') || function (frame) { window.setTimeout (frame, 1000 / 60) }

Transform = _.prototype ({
	constructor: function (value) {
		this.value = value || mat4.identity (mat4.create ())
	},
	inverse: function () {
		return new Transform (mat4.inverse (this.value, mat4.create ()))
	},
	multiply: function (right) {
		return new Transform (mat4.multiply (this.value, right.value, mat4.create ()))
	},
	apply: function (vec) {
		return mat4.multiplyVec3 (this.value, vec, vec3.create ())
	},
	applyInverse: function (vec) {
		return mat4.multiplyVec3 (mat4.inverse (this.value, mat4.create ()), vec, vec3.create ())
	},
	translate: function (vec) {
		return new Transform (mat4.translate (this.value, vec, mat4.create ()))
	},
	scale: function (vec) {
		return new Transform (mat4.scale (this.value, vec, mat4.create ()))
	}
})

Texture = _.prototype ({
	constructor: function (cfg) {
		_.extend (this, {
			gl: cfg.gl,
			texture: cfg.gl.createTexture (),
			width: cfg.width,
			height: cfg.height
		})
		this.gl.bindTexture (this.gl.TEXTURE_2D, this.texture)
		this.gl.texParameteri (this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST)
		this.gl.texParameteri (this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST)
		this.gl.texParameteri (this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE)
		this.gl.texParameteri (this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE)
		if (cfg.data) {
			this.update (cfg.data)
		}
	},
	update: function (data) {
		this.gl.bindTexture (this.gl.TEXTURE_2D, this.texture)
		this.gl.texImage2D (this.gl.TEXTURE_2D, 0, this.gl.RGBA,
			this.width, this.height, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, data)
	}
})

RenderTexture = _.prototype ({
	constructor: function (cfg) {
		_.extend (this, {
			gl: cfg.gl,
			framebuffer: cfg.gl.createFramebuffer (),
			texture: cfg.gl.createTexture ()
		})
		this.gl.bindTexture (this.gl.TEXTURE_2D, this.texture)
		this.gl.texParameteri (this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST)
		this.gl.texParameteri (this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST)
		this.gl.texParameteri (this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.REPEAT)
		this.gl.texParameteri (this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.REPEAT)
		this.resize (cfg.width, cfg.height)
		this.draw (function () {
			this.gl.framebufferTexture2D (this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, this.texture, 0)
		}, this)
	},
	draw: function (callback, context) {
		this.gl.bindFramebuffer (this.gl.FRAMEBUFFER, this.framebuffer)
		this.gl.viewport (0, 0, this.width, this.height)
		callback.call (context)
		this.gl.bindFramebuffer (this.gl.FRAMEBUFFER, null)
	},
	resize: function (width, height) {
		if (this.width != width || this.height != height) {
			this.gl.bindTexture (this.gl.TEXTURE_2D, this.texture)
			this.gl.texImage2D (this.gl.TEXTURE_2D, 0, this.gl.RGBA,
				this.width = width, this.height = height, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null)
		}
	},
	updateFromImage: function (image) {
		this.gl.bindTexture (this.gl.TEXTURE_2D, this.texture)
		this.gl.pixelStorei (this.gl.UNPACK_FLIP_Y_WEBGL, true);
        this.gl.texImage2D (this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, image);
	}
})

VertexBuffer = _.prototype ({
	constructor: function (cfg) {
		_.extend (this, {
			gl: 		cfg.gl,
			type: 		cfg.type,
			buffer: 	cfg.gl.createBuffer (),
			itemSize: 	3,
			itemCount: 	cfg.vertices.length / 3
		})
	    this.gl.bindBuffer (this.gl.ARRAY_BUFFER, this.buffer);
	    this.gl.bufferData (this.gl.ARRAY_BUFFER, new Float32Array (cfg.vertices), this.gl.STATIC_DRAW);
	},
	bind: function () {
		this.gl.bindBuffer (this.gl.ARRAY_BUFFER, this.buffer)
	},
	draw: function () {
		this.gl.drawArrays (this.type, 0, this.itemCount)
	}
})

ShaderAttribute = _.prototype ({
	constructor: function (gl, location) {
		this.gl = gl
		this.location = location
	},
	bindBuffer: function (buffer) {
		this.gl.enableVertexAttribArray (this.location)
		this.gl.vertexAttribPointer (this.location, buffer.itemSize, this.gl.FLOAT, false, 0, 0)
		buffer.bind ()
	}
})

ShaderUniform = _.prototype ({
	constructor: function (gl, location) {
		this.gl = gl
		this.location = location
	},
	set1i: function (x) {
		this.gl.uniform1i (this.location, x)
	},
	set1iv: function (x) {
		this.gl.uniform1iv (this.location, x)
	},
	set1f: function (x) {
		this.gl.uniform1f (this.location, x)
	},
	set2f: function (x, y) {
		this.gl.uniform2f (this.location, x, y)
	},
	set2fv: function (v) {
		this.gl.uniform2fv (this.location, vec2.create (v) /* uniform2fv doesn't like things like vec3 or vec4 as input */)
	},
	set3fv: function (v) {
		this.gl.uniform3fv (this.location, v)
	},
	setMatrix: function (m) {
		this.gl.uniformMatrix4fv (this.location, false, m.value)
	},
	bindTexture: function (texture, index) {
		this.gl.uniform1i (this.location, index)
		this.gl.activeTexture (this.gl.TEXTURE0 + index)
		this.gl.bindTexture (this.gl.TEXTURE_2D, texture.texture)
	}
})

ShaderProgram = _.prototype ({
	globals: {
		loadedShaders: {}
	},
	constructor: function (cfg) {
		this.gl = cfg.gl,
		this.program = cfg.gl.createProgram ()
		this.gl.attachShader (this.program, this.loadShader (cfg.vertex))
		this.gl.attachShader (this.program, this.loadShader (cfg.fragment))
		this.gl.linkProgram (this.program)
		if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
			alert ('Failed to link shader program')
		}
		this.attributes = _.object (_.map (cfg.attributes || [], function (name) {
			return [name, new ShaderAttribute (this.gl, this.gl.getAttribLocation (this.program, name))]
		}, this))
		this.uniforms = _.object (_.map (cfg.uniforms || [], function (name) {
			return [name, new ShaderUniform (this.gl, this.gl.getUniformLocation (this.program, name))]
		}, this))
	},
	loadShader: function (id) {
		if (id in ShaderProgram.loadedShaders) {
			return ShaderProgram.loadedShaders[id]
		} else {
			var script = $('#' + id)
			var shader = this.gl.createShader (
				script.attr ('type') == 'x-shader/x-fragment' ? this.gl.FRAGMENT_SHADER : this.gl.VERTEX_SHADER)
			this.gl.shaderSource (shader, script.text ())
			this.gl.compileShader (shader)
			if (!this.gl.getShaderParameter (shader, this.gl.COMPILE_STATUS)) {
				alert ('Failed to compile shader: ' + id + '\n' + this.gl.getShaderInfoLog (shader))
			}
			return (ShaderProgram.loadedShaders[id] = shader)
		}
	},
	use: function () {
		this.gl.useProgram (this.program)
	}
})

Viewport = _.prototype ({
	constructor: function (cfg) {
		_.extend (this, {
			viewportWidth: $(cfg.canvas).width (),
			viewportHeight: $(cfg.canvas).height (),
			canvas: cfg.canvas,
			lastFrameTime: 0,
			elapsedTime: 0,
			FPS: 0,
			gl: _.find (_.map (['webgl', 'experimental-webgl', 'webkit-3d', 'moz-webgl'], function (name) {
				try {
					return cfg.canvas.getContext (name)
				} catch (e) {
					return undefined
				}
			}), _.identity)
		})
		if (this.gl) {
			this.init ()
			this.render ()
		} else {
			this.noGL ()
		}
	},
	vertexBuffer: function (cfg) {
		return new VertexBuffer (_.extend ({ gl: this.gl }, cfg))
	},
	shaderProgram: function (cfg) {
		return new ShaderProgram (_.extend ({ gl: this.gl }, cfg))
	},
	texture: function (cfg) {
		return new Texture (_.extend ({ gl: this.gl }, cfg))
	},
	renderTexture: function (cfg) {
		return new RenderTexture (_.extend ({ gl: this.gl }, cfg))
	},
	render: function () {
		//var currentTime = new Date ().getTime ()
		//this.FPS = 1.0 / (this.elapsedTime = (currentTime - this.lastFrameTime) / 1000.0)
		//this.lastFrameTime = currentTime
		this.beforeDraw ()
		this.gl.viewport (0, 0, this.viewportWidth, this.viewportHeight)
		this.draw ()
		window.requestAnimationFrame ($.proxy (this.render, this), this.canvas)
	},
	resize: function (width, height) {
		$(this.canvas).attr ('width', this.viewportWidth = width)
		$(this.canvas).attr ('height', this.viewportHeight = height)
	},
	/* override this */
	init: function () {},
	beforeDraw: function () {},
	draw: function () {},
	doAnimation: function (elapsedTime) {}
})