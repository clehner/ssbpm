module.exports = function (sbot, cb) {
	var ssbpm = new SSBPM();
	cb(null, ssbpm)
}

function SSBPM() {
}

SSBPM.prototype.require = function (msg, cb) {
	console.log('require', msg)
	msg(null, {})
}
