exports.add = function fn() {
  var sum = 0, i = 0, args = fn.arguments, l = args.length
  while (i < l) {
    sum += args[i++]
  }
  return sum
}
