'use strict';
const GUARD = Symbol('GUARD');
module.exports = class Option {
  constructor(type, value, SECRET) {
    if (SECRET !== GUARD) {
      throw TypeError('Cannot extend Option');
    }
    this.type = type;
    this.value = value;
    Object.freeze(this);
  }
  static Some(value) {
    return new Option('Some', value, GUARD);
  }
  static None() {
    return new Option('None', Symbol('Error'), GUARD);
  }
}
