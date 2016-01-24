var example = require('example')
var math = require('example/math')

module.exports = function (t) {
  t.ok(true, 'run test in module')
  t.ok(example, 'load dependency')
  t.ok(math, 'load submodule of dependency')
  t.equal(example.increment(7), 8, 'run code in dependency')
  t.equal(math.add(4, 5), 9, 'run code in submodule dependency')
}
