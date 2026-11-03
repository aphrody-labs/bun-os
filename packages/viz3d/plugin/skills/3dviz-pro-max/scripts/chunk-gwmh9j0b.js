// @bun
// 3Dviz Pro Max helpers for Bun (MIT): built by Bun OS packages/viz3d from aphrody-labs/3dviz-pro-max@d077e0e68915. Do not edit; see NOTICE.
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  if (mod && typeof mod === "object" || typeof mod === "function") {
    for (let key of __getOwnPropNames(mod))
      if (!__hasOwnProp.call(to, key))
        __defProp(to, key, {
          get: __accessProp.bind(mod, key),
          enumerable: true
        });
  }
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __require = import.meta.require;

// ../../node_modules/ajv/dist/compile/codegen/code.js
var require_code = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.regexpCode = exports.getEsmExportName = exports.getProperty = exports.safeStringify = exports.stringify = exports.strConcat = exports.addCodeArg = exports.str = exports._ = exports.nil = exports._Code = exports.Name = exports.IDENTIFIER = exports._CodeOrName = undefined;

  class _CodeOrName {
  }
  exports._CodeOrName = _CodeOrName;
  exports.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;

  class Name extends _CodeOrName {
    constructor(s) {
      super();
      if (!exports.IDENTIFIER.test(s))
        throw new Error("CodeGen: name must be a valid identifier");
      this.str = s;
    }
    toString() {
      return this.str;
    }
    emptyStr() {
      return false;
    }
    get names() {
      return { [this.str]: 1 };
    }
  }
  exports.Name = Name;

  class _Code extends _CodeOrName {
    constructor(code) {
      super();
      this._items = typeof code === "string" ? [code] : code;
    }
    toString() {
      return this.str;
    }
    emptyStr() {
      if (this._items.length > 1)
        return false;
      const item = this._items[0];
      return item === "" || item === '""';
    }
    get str() {
      var _a;
      return (_a = this._str) !== null && _a !== undefined ? _a : this._str = this._items.reduce((s, c) => `${s}${c}`, "");
    }
    get names() {
      var _a;
      return (_a = this._names) !== null && _a !== undefined ? _a : this._names = this._items.reduce((names, c) => {
        if (c instanceof Name)
          names[c.str] = (names[c.str] || 0) + 1;
        return names;
      }, {});
    }
  }
  exports._Code = _Code;
  exports.nil = new _Code("");
  function _(strs, ...args) {
    const code = [strs[0]];
    let i = 0;
    while (i < args.length) {
      addCodeArg(code, args[i]);
      code.push(strs[++i]);
    }
    return new _Code(code);
  }
  exports._ = _;
  var plus = new _Code("+");
  function str(strs, ...args) {
    const expr = [safeStringify(strs[0])];
    let i = 0;
    while (i < args.length) {
      expr.push(plus);
      addCodeArg(expr, args[i]);
      expr.push(plus, safeStringify(strs[++i]));
    }
    optimize(expr);
    return new _Code(expr);
  }
  exports.str = str;
  function addCodeArg(code, arg) {
    if (arg instanceof _Code)
      code.push(...arg._items);
    else if (arg instanceof Name)
      code.push(arg);
    else
      code.push(interpolate(arg));
  }
  exports.addCodeArg = addCodeArg;
  function optimize(expr) {
    let i = 1;
    while (i < expr.length - 1) {
      if (expr[i] === plus) {
        const res = mergeExprItems(expr[i - 1], expr[i + 1]);
        if (res !== undefined) {
          expr.splice(i - 1, 3, res);
          continue;
        }
        expr[i++] = "+";
      }
      i++;
    }
  }
  function mergeExprItems(a, b) {
    if (b === '""')
      return a;
    if (a === '""')
      return b;
    if (typeof a == "string") {
      if (b instanceof Name || a[a.length - 1] !== '"')
        return;
      if (typeof b != "string")
        return `${a.slice(0, -1)}${b}"`;
      if (b[0] === '"')
        return a.slice(0, -1) + b.slice(1);
      return;
    }
    if (typeof b == "string" && b[0] === '"' && !(a instanceof Name))
      return `"${a}${b.slice(1)}`;
    return;
  }
  function strConcat(c1, c2) {
    return c2.emptyStr() ? c1 : c1.emptyStr() ? c2 : str`${c1}${c2}`;
  }
  exports.strConcat = strConcat;
  function interpolate(x) {
    return typeof x == "number" || typeof x == "boolean" || x === null ? x : safeStringify(Array.isArray(x) ? x.join(",") : x);
  }
  function stringify(x) {
    return new _Code(safeStringify(x));
  }
  exports.stringify = stringify;
  function safeStringify(x) {
    return JSON.stringify(x).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  }
  exports.safeStringify = safeStringify;
  function getProperty(key) {
    return typeof key == "string" && exports.IDENTIFIER.test(key) ? new _Code(`.${key}`) : _`[${key}]`;
  }
  exports.getProperty = getProperty;
  function getEsmExportName(key) {
    if (typeof key == "string" && exports.IDENTIFIER.test(key)) {
      return new _Code(`${key}`);
    }
    throw new Error(`CodeGen: invalid export name: ${key}, use explicit $id name mapping`);
  }
  exports.getEsmExportName = getEsmExportName;
  function regexpCode(rx) {
    return new _Code(rx.toString());
  }
  exports.regexpCode = regexpCode;
});

// ../../node_modules/ajv/dist/compile/codegen/scope.js
var require_scope = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.ValueScope = exports.ValueScopeName = exports.Scope = exports.varKinds = exports.UsedValueState = undefined;
  var code_1 = require_code();

  class ValueError extends Error {
    constructor(name) {
      super(`CodeGen: "code" for ${name} not defined`);
      this.value = name.value;
    }
  }
  var UsedValueState;
  (function(UsedValueState) {
    UsedValueState[UsedValueState["Started"] = 0] = "Started";
    UsedValueState[UsedValueState["Completed"] = 1] = "Completed";
  })(UsedValueState || (exports.UsedValueState = UsedValueState = {}));
  exports.varKinds = {
    const: new code_1.Name("const"),
    let: new code_1.Name("let"),
    var: new code_1.Name("var")
  };

  class Scope {
    constructor({ prefixes, parent } = {}) {
      this._names = {};
      this._prefixes = prefixes;
      this._parent = parent;
    }
    toName(nameOrPrefix) {
      return nameOrPrefix instanceof code_1.Name ? nameOrPrefix : this.name(nameOrPrefix);
    }
    name(prefix) {
      return new code_1.Name(this._newName(prefix));
    }
    _newName(prefix) {
      const ng = this._names[prefix] || this._nameGroup(prefix);
      return `${prefix}${ng.index++}`;
    }
    _nameGroup(prefix) {
      var _a, _b;
      if (((_b = (_a = this._parent) === null || _a === undefined ? undefined : _a._prefixes) === null || _b === undefined ? undefined : _b.has(prefix)) || this._prefixes && !this._prefixes.has(prefix)) {
        throw new Error(`CodeGen: prefix "${prefix}" is not allowed in this scope`);
      }
      return this._names[prefix] = { prefix, index: 0 };
    }
  }
  exports.Scope = Scope;

  class ValueScopeName extends code_1.Name {
    constructor(prefix, nameStr) {
      super(nameStr);
      this.prefix = prefix;
    }
    setValue(value, { property, itemIndex }) {
      this.value = value;
      this.scopePath = (0, code_1._)`.${new code_1.Name(property)}[${itemIndex}]`;
    }
  }
  exports.ValueScopeName = ValueScopeName;
  var line = (0, code_1._)`\n`;

  class ValueScope extends Scope {
    constructor(opts) {
      super(opts);
      this._values = {};
      this._scope = opts.scope;
      this.opts = { ...opts, _n: opts.lines ? line : code_1.nil };
    }
    get() {
      return this._scope;
    }
    name(prefix) {
      return new ValueScopeName(prefix, this._newName(prefix));
    }
    value(nameOrPrefix, value) {
      var _a;
      if (value.ref === undefined)
        throw new Error("CodeGen: ref must be passed in value");
      const name = this.toName(nameOrPrefix);
      const { prefix } = name;
      const valueKey = (_a = value.key) !== null && _a !== undefined ? _a : value.ref;
      let vs = this._values[prefix];
      if (vs) {
        const _name = vs.get(valueKey);
        if (_name)
          return _name;
      } else {
        vs = this._values[prefix] = new Map;
      }
      vs.set(valueKey, name);
      const s = this._scope[prefix] || (this._scope[prefix] = []);
      const itemIndex = s.length;
      s[itemIndex] = value.ref;
      name.setValue(value, { property: prefix, itemIndex });
      return name;
    }
    getValue(prefix, keyOrRef) {
      const vs = this._values[prefix];
      if (!vs)
        return;
      return vs.get(keyOrRef);
    }
    scopeRefs(scopeName, values = this._values) {
      return this._reduceValues(values, (name) => {
        if (name.scopePath === undefined)
          throw new Error(`CodeGen: name "${name}" has no value`);
        return (0, code_1._)`${scopeName}${name.scopePath}`;
      });
    }
    scopeCode(values = this._values, usedValues, getCode) {
      return this._reduceValues(values, (name) => {
        if (name.value === undefined)
          throw new Error(`CodeGen: name "${name}" has no value`);
        return name.value.code;
      }, usedValues, getCode);
    }
    _reduceValues(values, valueCode, usedValues = {}, getCode) {
      let code = code_1.nil;
      for (const prefix in values) {
        const vs = values[prefix];
        if (!vs)
          continue;
        const nameSet = usedValues[prefix] = usedValues[prefix] || new Map;
        vs.forEach((name) => {
          if (nameSet.has(name))
            return;
          nameSet.set(name, UsedValueState.Started);
          let c = valueCode(name);
          if (c) {
            const def = this.opts.es5 ? exports.varKinds.var : exports.varKinds.const;
            code = (0, code_1._)`${code}${def} ${name} = ${c};${this.opts._n}`;
          } else if (c = getCode === null || getCode === undefined ? undefined : getCode(name)) {
            code = (0, code_1._)`${code}${c}${this.opts._n}`;
          } else {
            throw new ValueError(name);
          }
          nameSet.set(name, UsedValueState.Completed);
        });
      }
      return code;
    }
  }
  exports.ValueScope = ValueScope;
});

// ../../node_modules/ajv/dist/compile/codegen/index.js
var require_codegen = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.or = exports.and = exports.not = exports.CodeGen = exports.operators = exports.varKinds = exports.ValueScopeName = exports.ValueScope = exports.Scope = exports.Name = exports.regexpCode = exports.stringify = exports.getProperty = exports.nil = exports.strConcat = exports.str = exports._ = undefined;
  var code_1 = require_code();
  var scope_1 = require_scope();
  var code_2 = require_code();
  Object.defineProperty(exports, "_", { enumerable: true, get: function() {
    return code_2._;
  } });
  Object.defineProperty(exports, "str", { enumerable: true, get: function() {
    return code_2.str;
  } });
  Object.defineProperty(exports, "strConcat", { enumerable: true, get: function() {
    return code_2.strConcat;
  } });
  Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
    return code_2.nil;
  } });
  Object.defineProperty(exports, "getProperty", { enumerable: true, get: function() {
    return code_2.getProperty;
  } });
  Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
    return code_2.stringify;
  } });
  Object.defineProperty(exports, "regexpCode", { enumerable: true, get: function() {
    return code_2.regexpCode;
  } });
  Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
    return code_2.Name;
  } });
  var scope_2 = require_scope();
  Object.defineProperty(exports, "Scope", { enumerable: true, get: function() {
    return scope_2.Scope;
  } });
  Object.defineProperty(exports, "ValueScope", { enumerable: true, get: function() {
    return scope_2.ValueScope;
  } });
  Object.defineProperty(exports, "ValueScopeName", { enumerable: true, get: function() {
    return scope_2.ValueScopeName;
  } });
  Object.defineProperty(exports, "varKinds", { enumerable: true, get: function() {
    return scope_2.varKinds;
  } });
  exports.operators = {
    GT: new code_1._Code(">"),
    GTE: new code_1._Code(">="),
    LT: new code_1._Code("<"),
    LTE: new code_1._Code("<="),
    EQ: new code_1._Code("==="),
    NEQ: new code_1._Code("!=="),
    NOT: new code_1._Code("!"),
    OR: new code_1._Code("||"),
    AND: new code_1._Code("&&"),
    ADD: new code_1._Code("+")
  };

  class Node {
    optimizeNodes() {
      return this;
    }
    optimizeNames(_names, _constants) {
      return this;
    }
  }

  class Def extends Node {
    constructor(varKind, name, rhs) {
      super();
      this.varKind = varKind;
      this.name = name;
      this.rhs = rhs;
    }
    render({ es5, _n }) {
      const varKind = es5 ? scope_1.varKinds.var : this.varKind;
      const rhs = this.rhs === undefined ? "" : ` = ${this.rhs}`;
      return `${varKind} ${this.name}${rhs};` + _n;
    }
    optimizeNames(names, constants) {
      if (!names[this.name.str])
        return;
      if (this.rhs)
        this.rhs = optimizeExpr(this.rhs, names, constants);
      return this;
    }
    get names() {
      return this.rhs instanceof code_1._CodeOrName ? this.rhs.names : {};
    }
  }

  class Assign extends Node {
    constructor(lhs, rhs, sideEffects) {
      super();
      this.lhs = lhs;
      this.rhs = rhs;
      this.sideEffects = sideEffects;
    }
    render({ _n }) {
      return `${this.lhs} = ${this.rhs};` + _n;
    }
    optimizeNames(names, constants) {
      if (this.lhs instanceof code_1.Name && !names[this.lhs.str] && !this.sideEffects)
        return;
      this.rhs = optimizeExpr(this.rhs, names, constants);
      return this;
    }
    get names() {
      const names = this.lhs instanceof code_1.Name ? {} : { ...this.lhs.names };
      return addExprNames(names, this.rhs);
    }
  }

  class AssignOp extends Assign {
    constructor(lhs, op, rhs, sideEffects) {
      super(lhs, rhs, sideEffects);
      this.op = op;
    }
    render({ _n }) {
      return `${this.lhs} ${this.op}= ${this.rhs};` + _n;
    }
  }

  class Label extends Node {
    constructor(label) {
      super();
      this.label = label;
      this.names = {};
    }
    render({ _n }) {
      return `${this.label}:` + _n;
    }
  }

  class Break extends Node {
    constructor(label) {
      super();
      this.label = label;
      this.names = {};
    }
    render({ _n }) {
      const label = this.label ? ` ${this.label}` : "";
      return `break${label};` + _n;
    }
  }

  class Throw extends Node {
    constructor(error) {
      super();
      this.error = error;
    }
    render({ _n }) {
      return `throw ${this.error};` + _n;
    }
    get names() {
      return this.error.names;
    }
  }

  class AnyCode extends Node {
    constructor(code) {
      super();
      this.code = code;
    }
    render({ _n }) {
      return `${this.code};` + _n;
    }
    optimizeNodes() {
      return `${this.code}` ? this : undefined;
    }
    optimizeNames(names, constants) {
      this.code = optimizeExpr(this.code, names, constants);
      return this;
    }
    get names() {
      return this.code instanceof code_1._CodeOrName ? this.code.names : {};
    }
  }

  class ParentNode extends Node {
    constructor(nodes = []) {
      super();
      this.nodes = nodes;
    }
    render(opts) {
      return this.nodes.reduce((code, n) => code + n.render(opts), "");
    }
    optimizeNodes() {
      const { nodes } = this;
      let i = nodes.length;
      while (i--) {
        const n = nodes[i].optimizeNodes();
        if (Array.isArray(n))
          nodes.splice(i, 1, ...n);
        else if (n)
          nodes[i] = n;
        else
          nodes.splice(i, 1);
      }
      return nodes.length > 0 ? this : undefined;
    }
    optimizeNames(names, constants) {
      const { nodes } = this;
      let i = nodes.length;
      while (i--) {
        const n = nodes[i];
        if (n.optimizeNames(names, constants))
          continue;
        subtractNames(names, n.names);
        nodes.splice(i, 1);
      }
      return nodes.length > 0 ? this : undefined;
    }
    get names() {
      return this.nodes.reduce((names, n) => addNames(names, n.names), {});
    }
  }

  class BlockNode extends ParentNode {
    render(opts) {
      return "{" + opts._n + super.render(opts) + "}" + opts._n;
    }
  }

  class Root extends ParentNode {
  }

  class Else extends BlockNode {
  }
  Else.kind = "else";

  class If extends BlockNode {
    constructor(condition, nodes) {
      super(nodes);
      this.condition = condition;
    }
    render(opts) {
      let code = `if(${this.condition})` + super.render(opts);
      if (this.else)
        code += "else " + this.else.render(opts);
      return code;
    }
    optimizeNodes() {
      super.optimizeNodes();
      const cond = this.condition;
      if (cond === true)
        return this.nodes;
      let e = this.else;
      if (e) {
        const ns = e.optimizeNodes();
        e = this.else = Array.isArray(ns) ? new Else(ns) : ns;
      }
      if (e) {
        if (cond === false)
          return e instanceof If ? e : e.nodes;
        if (this.nodes.length)
          return this;
        return new If(not(cond), e instanceof If ? [e] : e.nodes);
      }
      if (cond === false || !this.nodes.length)
        return;
      return this;
    }
    optimizeNames(names, constants) {
      var _a;
      this.else = (_a = this.else) === null || _a === undefined ? undefined : _a.optimizeNames(names, constants);
      if (!(super.optimizeNames(names, constants) || this.else))
        return;
      this.condition = optimizeExpr(this.condition, names, constants);
      return this;
    }
    get names() {
      const names = super.names;
      addExprNames(names, this.condition);
      if (this.else)
        addNames(names, this.else.names);
      return names;
    }
  }
  If.kind = "if";

  class For extends BlockNode {
  }
  For.kind = "for";

  class ForLoop extends For {
    constructor(iteration) {
      super();
      this.iteration = iteration;
    }
    render(opts) {
      return `for(${this.iteration})` + super.render(opts);
    }
    optimizeNames(names, constants) {
      if (!super.optimizeNames(names, constants))
        return;
      this.iteration = optimizeExpr(this.iteration, names, constants);
      return this;
    }
    get names() {
      return addNames(super.names, this.iteration.names);
    }
  }

  class ForRange extends For {
    constructor(varKind, name, from, to) {
      super();
      this.varKind = varKind;
      this.name = name;
      this.from = from;
      this.to = to;
    }
    render(opts) {
      const varKind = opts.es5 ? scope_1.varKinds.var : this.varKind;
      const { name, from, to } = this;
      return `for(${varKind} ${name}=${from}; ${name}<${to}; ${name}++)` + super.render(opts);
    }
    get names() {
      const names = addExprNames(super.names, this.from);
      return addExprNames(names, this.to);
    }
  }

  class ForIter extends For {
    constructor(loop, varKind, name, iterable) {
      super();
      this.loop = loop;
      this.varKind = varKind;
      this.name = name;
      this.iterable = iterable;
    }
    render(opts) {
      return `for(${this.varKind} ${this.name} ${this.loop} ${this.iterable})` + super.render(opts);
    }
    optimizeNames(names, constants) {
      if (!super.optimizeNames(names, constants))
        return;
      this.iterable = optimizeExpr(this.iterable, names, constants);
      return this;
    }
    get names() {
      return addNames(super.names, this.iterable.names);
    }
  }

  class Func extends BlockNode {
    constructor(name, args, async) {
      super();
      this.name = name;
      this.args = args;
      this.async = async;
    }
    render(opts) {
      const _async = this.async ? "async " : "";
      return `${_async}function ${this.name}(${this.args})` + super.render(opts);
    }
  }
  Func.kind = "func";

  class Return extends ParentNode {
    render(opts) {
      return "return " + super.render(opts);
    }
  }
  Return.kind = "return";

  class Try extends BlockNode {
    render(opts) {
      let code = "try" + super.render(opts);
      if (this.catch)
        code += this.catch.render(opts);
      if (this.finally)
        code += this.finally.render(opts);
      return code;
    }
    optimizeNodes() {
      var _a, _b;
      super.optimizeNodes();
      (_a = this.catch) === null || _a === undefined || _a.optimizeNodes();
      (_b = this.finally) === null || _b === undefined || _b.optimizeNodes();
      return this;
    }
    optimizeNames(names, constants) {
      var _a, _b;
      super.optimizeNames(names, constants);
      (_a = this.catch) === null || _a === undefined || _a.optimizeNames(names, constants);
      (_b = this.finally) === null || _b === undefined || _b.optimizeNames(names, constants);
      return this;
    }
    get names() {
      const names = super.names;
      if (this.catch)
        addNames(names, this.catch.names);
      if (this.finally)
        addNames(names, this.finally.names);
      return names;
    }
  }

  class Catch extends BlockNode {
    constructor(error) {
      super();
      this.error = error;
    }
    render(opts) {
      return `catch(${this.error})` + super.render(opts);
    }
  }
  Catch.kind = "catch";

  class Finally extends BlockNode {
    render(opts) {
      return "finally" + super.render(opts);
    }
  }
  Finally.kind = "finally";

  class CodeGen {
    constructor(extScope, opts = {}) {
      this._values = {};
      this._blockStarts = [];
      this._constants = {};
      this.opts = { ...opts, _n: opts.lines ? `
` : "" };
      this._extScope = extScope;
      this._scope = new scope_1.Scope({ parent: extScope });
      this._nodes = [new Root];
    }
    toString() {
      return this._root.render(this.opts);
    }
    name(prefix) {
      return this._scope.name(prefix);
    }
    scopeName(prefix) {
      return this._extScope.name(prefix);
    }
    scopeValue(prefixOrName, value) {
      const name = this._extScope.value(prefixOrName, value);
      const vs = this._values[name.prefix] || (this._values[name.prefix] = new Set);
      vs.add(name);
      return name;
    }
    getScopeValue(prefix, keyOrRef) {
      return this._extScope.getValue(prefix, keyOrRef);
    }
    scopeRefs(scopeName) {
      return this._extScope.scopeRefs(scopeName, this._values);
    }
    scopeCode() {
      return this._extScope.scopeCode(this._values);
    }
    _def(varKind, nameOrPrefix, rhs, constant) {
      const name = this._scope.toName(nameOrPrefix);
      if (rhs !== undefined && constant)
        this._constants[name.str] = rhs;
      this._leafNode(new Def(varKind, name, rhs));
      return name;
    }
    const(nameOrPrefix, rhs, _constant) {
      return this._def(scope_1.varKinds.const, nameOrPrefix, rhs, _constant);
    }
    let(nameOrPrefix, rhs, _constant) {
      return this._def(scope_1.varKinds.let, nameOrPrefix, rhs, _constant);
    }
    var(nameOrPrefix, rhs, _constant) {
      return this._def(scope_1.varKinds.var, nameOrPrefix, rhs, _constant);
    }
    assign(lhs, rhs, sideEffects) {
      return this._leafNode(new Assign(lhs, rhs, sideEffects));
    }
    add(lhs, rhs) {
      return this._leafNode(new AssignOp(lhs, exports.operators.ADD, rhs));
    }
    code(c) {
      if (typeof c == "function")
        c();
      else if (c !== code_1.nil)
        this._leafNode(new AnyCode(c));
      return this;
    }
    object(...keyValues) {
      const code = ["{"];
      for (const [key, value] of keyValues) {
        if (code.length > 1)
          code.push(",");
        code.push(key);
        if (key !== value || this.opts.es5) {
          code.push(":");
          (0, code_1.addCodeArg)(code, value);
        }
      }
      code.push("}");
      return new code_1._Code(code);
    }
    if(condition, thenBody, elseBody) {
      this._blockNode(new If(condition));
      if (thenBody && elseBody) {
        this.code(thenBody).else().code(elseBody).endIf();
      } else if (thenBody) {
        this.code(thenBody).endIf();
      } else if (elseBody) {
        throw new Error('CodeGen: "else" body without "then" body');
      }
      return this;
    }
    elseIf(condition) {
      return this._elseNode(new If(condition));
    }
    else() {
      return this._elseNode(new Else);
    }
    endIf() {
      return this._endBlockNode(If, Else);
    }
    _for(node, forBody) {
      this._blockNode(node);
      if (forBody)
        this.code(forBody).endFor();
      return this;
    }
    for(iteration, forBody) {
      return this._for(new ForLoop(iteration), forBody);
    }
    forRange(nameOrPrefix, from, to, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.let) {
      const name = this._scope.toName(nameOrPrefix);
      return this._for(new ForRange(varKind, name, from, to), () => forBody(name));
    }
    forOf(nameOrPrefix, iterable, forBody, varKind = scope_1.varKinds.const) {
      const name = this._scope.toName(nameOrPrefix);
      if (this.opts.es5) {
        const arr = iterable instanceof code_1.Name ? iterable : this.var("_arr", iterable);
        return this.forRange("_i", 0, (0, code_1._)`${arr}.length`, (i) => {
          this.var(name, (0, code_1._)`${arr}[${i}]`);
          forBody(name);
        });
      }
      return this._for(new ForIter("of", varKind, name, iterable), () => forBody(name));
    }
    forIn(nameOrPrefix, obj, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.const) {
      if (this.opts.ownProperties) {
        return this.forOf(nameOrPrefix, (0, code_1._)`Object.keys(${obj})`, forBody);
      }
      const name = this._scope.toName(nameOrPrefix);
      return this._for(new ForIter("in", varKind, name, obj), () => forBody(name));
    }
    endFor() {
      return this._endBlockNode(For);
    }
    label(label) {
      return this._leafNode(new Label(label));
    }
    break(label) {
      return this._leafNode(new Break(label));
    }
    return(value) {
      const node = new Return;
      this._blockNode(node);
      this.code(value);
      if (node.nodes.length !== 1)
        throw new Error('CodeGen: "return" should have one node');
      return this._endBlockNode(Return);
    }
    try(tryBody, catchCode, finallyCode) {
      if (!catchCode && !finallyCode)
        throw new Error('CodeGen: "try" without "catch" and "finally"');
      const node = new Try;
      this._blockNode(node);
      this.code(tryBody);
      if (catchCode) {
        const error = this.name("e");
        this._currNode = node.catch = new Catch(error);
        catchCode(error);
      }
      if (finallyCode) {
        this._currNode = node.finally = new Finally;
        this.code(finallyCode);
      }
      return this._endBlockNode(Catch, Finally);
    }
    throw(error) {
      return this._leafNode(new Throw(error));
    }
    block(body, nodeCount) {
      this._blockStarts.push(this._nodes.length);
      if (body)
        this.code(body).endBlock(nodeCount);
      return this;
    }
    endBlock(nodeCount) {
      const len = this._blockStarts.pop();
      if (len === undefined)
        throw new Error("CodeGen: not in self-balancing block");
      const toClose = this._nodes.length - len;
      if (toClose < 0 || nodeCount !== undefined && toClose !== nodeCount) {
        throw new Error(`CodeGen: wrong number of nodes: ${toClose} vs ${nodeCount} expected`);
      }
      this._nodes.length = len;
      return this;
    }
    func(name, args = code_1.nil, async, funcBody) {
      this._blockNode(new Func(name, args, async));
      if (funcBody)
        this.code(funcBody).endFunc();
      return this;
    }
    endFunc() {
      return this._endBlockNode(Func);
    }
    optimize(n = 1) {
      while (n-- > 0) {
        this._root.optimizeNodes();
        this._root.optimizeNames(this._root.names, this._constants);
      }
    }
    _leafNode(node) {
      this._currNode.nodes.push(node);
      return this;
    }
    _blockNode(node) {
      this._currNode.nodes.push(node);
      this._nodes.push(node);
    }
    _endBlockNode(N1, N2) {
      const n = this._currNode;
      if (n instanceof N1 || N2 && n instanceof N2) {
        this._nodes.pop();
        return this;
      }
      throw new Error(`CodeGen: not in block "${N2 ? `${N1.kind}/${N2.kind}` : N1.kind}"`);
    }
    _elseNode(node) {
      const n = this._currNode;
      if (!(n instanceof If)) {
        throw new Error('CodeGen: "else" without "if"');
      }
      this._currNode = n.else = node;
      return this;
    }
    get _root() {
      return this._nodes[0];
    }
    get _currNode() {
      const ns = this._nodes;
      return ns[ns.length - 1];
    }
    set _currNode(node) {
      const ns = this._nodes;
      ns[ns.length - 1] = node;
    }
  }
  exports.CodeGen = CodeGen;
  function addNames(names, from) {
    for (const n in from)
      names[n] = (names[n] || 0) + (from[n] || 0);
    return names;
  }
  function addExprNames(names, from) {
    return from instanceof code_1._CodeOrName ? addNames(names, from.names) : names;
  }
  function optimizeExpr(expr, names, constants) {
    if (expr instanceof code_1.Name)
      return replaceName(expr);
    if (!canOptimize(expr))
      return expr;
    return new code_1._Code(expr._items.reduce((items, c) => {
      if (c instanceof code_1.Name)
        c = replaceName(c);
      if (c instanceof code_1._Code)
        items.push(...c._items);
      else
        items.push(c);
      return items;
    }, []));
    function replaceName(n) {
      const c = constants[n.str];
      if (c === undefined || names[n.str] !== 1)
        return n;
      delete names[n.str];
      return c;
    }
    function canOptimize(e) {
      return e instanceof code_1._Code && e._items.some((c) => c instanceof code_1.Name && names[c.str] === 1 && constants[c.str] !== undefined);
    }
  }
  function subtractNames(names, from) {
    for (const n in from)
      names[n] = (names[n] || 0) - (from[n] || 0);
  }
  function not(x) {
    return typeof x == "boolean" || typeof x == "number" || x === null ? !x : (0, code_1._)`!${par(x)}`;
  }
  exports.not = not;
  var andCode = mappend(exports.operators.AND);
  function and(...args) {
    return args.reduce(andCode);
  }
  exports.and = and;
  var orCode = mappend(exports.operators.OR);
  function or(...args) {
    return args.reduce(orCode);
  }
  exports.or = or;
  function mappend(op) {
    return (x, y) => x === code_1.nil ? y : y === code_1.nil ? x : (0, code_1._)`${par(x)} ${op} ${par(y)}`;
  }
  function par(x) {
    return x instanceof code_1.Name ? x : (0, code_1._)`(${x})`;
  }
});

// ../../node_modules/ajv/dist/compile/util.js
var require_util = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.checkStrictMode = exports.getErrorPath = exports.Type = exports.useFunc = exports.setEvaluated = exports.evaluatedPropsToName = exports.mergeEvaluated = exports.eachItem = exports.unescapeJsonPointer = exports.escapeJsonPointer = exports.escapeFragment = exports.unescapeFragment = exports.schemaRefOrVal = exports.schemaHasRulesButRef = exports.schemaHasRules = exports.checkUnknownRules = exports.alwaysValidSchema = exports.toHash = undefined;
  var codegen_1 = require_codegen();
  var code_1 = require_code();
  function toHash(arr) {
    const hash = {};
    for (const item of arr)
      hash[item] = true;
    return hash;
  }
  exports.toHash = toHash;
  function alwaysValidSchema(it, schema) {
    if (typeof schema == "boolean")
      return schema;
    if (Object.keys(schema).length === 0)
      return true;
    checkUnknownRules(it, schema);
    return !schemaHasRules(schema, it.self.RULES.all);
  }
  exports.alwaysValidSchema = alwaysValidSchema;
  function checkUnknownRules(it, schema = it.schema) {
    const { opts, self } = it;
    if (!opts.strictSchema)
      return;
    if (typeof schema === "boolean")
      return;
    const rules = self.RULES.keywords;
    for (const key in schema) {
      if (!rules[key])
        checkStrictMode(it, `unknown keyword: "${key}"`);
    }
  }
  exports.checkUnknownRules = checkUnknownRules;
  function schemaHasRules(schema, rules) {
    if (typeof schema == "boolean")
      return !schema;
    for (const key in schema)
      if (rules[key])
        return true;
    return false;
  }
  exports.schemaHasRules = schemaHasRules;
  function schemaHasRulesButRef(schema, RULES) {
    if (typeof schema == "boolean")
      return !schema;
    for (const key in schema)
      if (key !== "$ref" && RULES.all[key])
        return true;
    return false;
  }
  exports.schemaHasRulesButRef = schemaHasRulesButRef;
  function schemaRefOrVal({ topSchemaRef, schemaPath }, schema, keyword, $data) {
    if (!$data) {
      if (typeof schema == "number" || typeof schema == "boolean")
        return schema;
      if (typeof schema == "string")
        return (0, codegen_1._)`${schema}`;
    }
    return (0, codegen_1._)`${topSchemaRef}${schemaPath}${(0, codegen_1.getProperty)(keyword)}`;
  }
  exports.schemaRefOrVal = schemaRefOrVal;
  function unescapeFragment(str) {
    return unescapeJsonPointer(decodeURIComponent(str));
  }
  exports.unescapeFragment = unescapeFragment;
  function escapeFragment(str) {
    return encodeURIComponent(escapeJsonPointer(str));
  }
  exports.escapeFragment = escapeFragment;
  function escapeJsonPointer(str) {
    if (typeof str == "number")
      return `${str}`;
    return str.replace(/~/g, "~0").replace(/\//g, "~1");
  }
  exports.escapeJsonPointer = escapeJsonPointer;
  function unescapeJsonPointer(str) {
    return str.replace(/~1/g, "/").replace(/~0/g, "~");
  }
  exports.unescapeJsonPointer = unescapeJsonPointer;
  function eachItem(xs, f) {
    if (Array.isArray(xs)) {
      for (const x of xs)
        f(x);
    } else {
      f(xs);
    }
  }
  exports.eachItem = eachItem;
  function makeMergeEvaluated({ mergeNames, mergeToName, mergeValues, resultToName }) {
    return (gen, from, to, toName) => {
      const res = to === undefined ? from : to instanceof codegen_1.Name ? (from instanceof codegen_1.Name ? mergeNames(gen, from, to) : mergeToName(gen, from, to), to) : from instanceof codegen_1.Name ? (mergeToName(gen, to, from), from) : mergeValues(from, to);
      return toName === codegen_1.Name && !(res instanceof codegen_1.Name) ? resultToName(gen, res) : res;
    };
  }
  exports.mergeEvaluated = {
    props: makeMergeEvaluated({
      mergeNames: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true && ${from} !== undefined`, () => {
        gen.if((0, codegen_1._)`${from} === true`, () => gen.assign(to, true), () => gen.assign(to, (0, codegen_1._)`${to} || {}`).code((0, codegen_1._)`Object.assign(${to}, ${from})`));
      }),
      mergeToName: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true`, () => {
        if (from === true) {
          gen.assign(to, true);
        } else {
          gen.assign(to, (0, codegen_1._)`${to} || {}`);
          setEvaluated(gen, to, from);
        }
      }),
      mergeValues: (from, to) => from === true ? true : { ...from, ...to },
      resultToName: evaluatedPropsToName
    }),
    items: makeMergeEvaluated({
      mergeNames: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true && ${from} !== undefined`, () => gen.assign(to, (0, codegen_1._)`${from} === true ? true : ${to} > ${from} ? ${to} : ${from}`)),
      mergeToName: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true`, () => gen.assign(to, from === true ? true : (0, codegen_1._)`${to} > ${from} ? ${to} : ${from}`)),
      mergeValues: (from, to) => from === true ? true : Math.max(from, to),
      resultToName: (gen, items) => gen.var("items", items)
    })
  };
  function evaluatedPropsToName(gen, ps) {
    if (ps === true)
      return gen.var("props", true);
    const props = gen.var("props", (0, codegen_1._)`{}`);
    if (ps !== undefined)
      setEvaluated(gen, props, ps);
    return props;
  }
  exports.evaluatedPropsToName = evaluatedPropsToName;
  function setEvaluated(gen, props, ps) {
    Object.keys(ps).forEach((p) => gen.assign((0, codegen_1._)`${props}${(0, codegen_1.getProperty)(p)}`, true));
  }
  exports.setEvaluated = setEvaluated;
  var snippets = {};
  function useFunc(gen, f) {
    return gen.scopeValue("func", {
      ref: f,
      code: snippets[f.code] || (snippets[f.code] = new code_1._Code(f.code))
    });
  }
  exports.useFunc = useFunc;
  var Type;
  (function(Type) {
    Type[Type["Num"] = 0] = "Num";
    Type[Type["Str"] = 1] = "Str";
  })(Type || (exports.Type = Type = {}));
  function getErrorPath(dataProp, dataPropType, jsPropertySyntax) {
    if (dataProp instanceof codegen_1.Name) {
      const isNumber = dataPropType === Type.Num;
      return jsPropertySyntax ? isNumber ? (0, codegen_1._)`"[" + ${dataProp} + "]"` : (0, codegen_1._)`"['" + ${dataProp} + "']"` : isNumber ? (0, codegen_1._)`"/" + ${dataProp}` : (0, codegen_1._)`"/" + ${dataProp}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
    }
    return jsPropertySyntax ? (0, codegen_1.getProperty)(dataProp).toString() : "/" + escapeJsonPointer(dataProp);
  }
  exports.getErrorPath = getErrorPath;
  function checkStrictMode(it, msg, mode = it.opts.strictSchema) {
    if (!mode)
      return;
    msg = `strict mode: ${msg}`;
    if (mode === true)
      throw new Error(msg);
    it.self.logger.warn(msg);
  }
  exports.checkStrictMode = checkStrictMode;
});

// ../../node_modules/ajv/dist/compile/names.js
var require_names = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var names = {
    data: new codegen_1.Name("data"),
    valCxt: new codegen_1.Name("valCxt"),
    instancePath: new codegen_1.Name("instancePath"),
    parentData: new codegen_1.Name("parentData"),
    parentDataProperty: new codegen_1.Name("parentDataProperty"),
    rootData: new codegen_1.Name("rootData"),
    dynamicAnchors: new codegen_1.Name("dynamicAnchors"),
    vErrors: new codegen_1.Name("vErrors"),
    errors: new codegen_1.Name("errors"),
    this: new codegen_1.Name("this"),
    self: new codegen_1.Name("self"),
    scope: new codegen_1.Name("scope"),
    json: new codegen_1.Name("json"),
    jsonPos: new codegen_1.Name("jsonPos"),
    jsonLen: new codegen_1.Name("jsonLen"),
    jsonPart: new codegen_1.Name("jsonPart")
  };
  exports.default = names;
});

// ../../node_modules/ajv/dist/compile/errors.js
var require_errors = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.extendErrors = exports.resetErrorsCount = exports.reportExtraError = exports.reportError = exports.keyword$DataError = exports.keywordError = undefined;
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var names_1 = require_names();
  exports.keywordError = {
    message: ({ keyword }) => (0, codegen_1.str)`must pass "${keyword}" keyword validation`
  };
  exports.keyword$DataError = {
    message: ({ keyword, schemaType }) => schemaType ? (0, codegen_1.str)`"${keyword}" keyword must be ${schemaType} ($data)` : (0, codegen_1.str)`"${keyword}" keyword is invalid ($data)`
  };
  function reportError2(cxt, error = exports.keywordError, errorPaths, overrideAllErrors) {
    const { it } = cxt;
    const { gen, compositeRule, allErrors } = it;
    const errObj = errorObjectCode(cxt, error, errorPaths);
    if (overrideAllErrors !== null && overrideAllErrors !== undefined ? overrideAllErrors : compositeRule || allErrors) {
      addError(gen, errObj);
    } else {
      returnErrors(it, (0, codegen_1._)`[${errObj}]`);
    }
  }
  exports.reportError = reportError2;
  function reportExtraError(cxt, error = exports.keywordError, errorPaths) {
    const { it } = cxt;
    const { gen, compositeRule, allErrors } = it;
    const errObj = errorObjectCode(cxt, error, errorPaths);
    addError(gen, errObj);
    if (!(compositeRule || allErrors)) {
      returnErrors(it, names_1.default.vErrors);
    }
  }
  exports.reportExtraError = reportExtraError;
  function resetErrorsCount(gen, errsCount) {
    gen.assign(names_1.default.errors, errsCount);
    gen.if((0, codegen_1._)`${names_1.default.vErrors} !== null`, () => gen.if(errsCount, () => gen.assign((0, codegen_1._)`${names_1.default.vErrors}.length`, errsCount), () => gen.assign(names_1.default.vErrors, null)));
  }
  exports.resetErrorsCount = resetErrorsCount;
  function extendErrors({ gen, keyword, schemaValue, data, errsCount, it }) {
    if (errsCount === undefined)
      throw new Error("ajv implementation error");
    const err = gen.name("err");
    gen.forRange("i", errsCount, names_1.default.errors, (i) => {
      gen.const(err, (0, codegen_1._)`${names_1.default.vErrors}[${i}]`);
      gen.if((0, codegen_1._)`${err}.instancePath === undefined`, () => gen.assign((0, codegen_1._)`${err}.instancePath`, (0, codegen_1.strConcat)(names_1.default.instancePath, it.errorPath)));
      gen.assign((0, codegen_1._)`${err}.schemaPath`, (0, codegen_1.str)`${it.errSchemaPath}/${keyword}`);
      if (it.opts.verbose) {
        gen.assign((0, codegen_1._)`${err}.schema`, schemaValue);
        gen.assign((0, codegen_1._)`${err}.data`, data);
      }
    });
  }
  exports.extendErrors = extendErrors;
  function addError(gen, errObj) {
    const err = gen.const("err", errObj);
    gen.if((0, codegen_1._)`${names_1.default.vErrors} === null`, () => gen.assign(names_1.default.vErrors, (0, codegen_1._)`[${err}]`), (0, codegen_1._)`${names_1.default.vErrors}.push(${err})`);
    gen.code((0, codegen_1._)`${names_1.default.errors}++`);
  }
  function returnErrors(it, errs) {
    const { gen, validateName, schemaEnv } = it;
    if (schemaEnv.$async) {
      gen.throw((0, codegen_1._)`new ${it.ValidationError}(${errs})`);
    } else {
      gen.assign((0, codegen_1._)`${validateName}.errors`, errs);
      gen.return(false);
    }
  }
  var E = {
    keyword: new codegen_1.Name("keyword"),
    schemaPath: new codegen_1.Name("schemaPath"),
    params: new codegen_1.Name("params"),
    propertyName: new codegen_1.Name("propertyName"),
    message: new codegen_1.Name("message"),
    schema: new codegen_1.Name("schema"),
    parentSchema: new codegen_1.Name("parentSchema")
  };
  function errorObjectCode(cxt, error, errorPaths) {
    const { createErrors } = cxt.it;
    if (createErrors === false)
      return (0, codegen_1._)`{}`;
    return errorObject(cxt, error, errorPaths);
  }
  function errorObject(cxt, error, errorPaths = {}) {
    const { gen, it } = cxt;
    const keyValues = [
      errorInstancePath(it, errorPaths),
      errorSchemaPath(cxt, errorPaths)
    ];
    extraErrorProps(cxt, error, keyValues);
    return gen.object(...keyValues);
  }
  function errorInstancePath({ errorPath }, { instancePath }) {
    const instPath = instancePath ? (0, codegen_1.str)`${errorPath}${(0, util_1.getErrorPath)(instancePath, util_1.Type.Str)}` : errorPath;
    return [names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, instPath)];
  }
  function errorSchemaPath({ keyword, it: { errSchemaPath } }, { schemaPath, parentSchema }) {
    let schPath = parentSchema ? errSchemaPath : (0, codegen_1.str)`${errSchemaPath}/${keyword}`;
    if (schemaPath) {
      schPath = (0, codegen_1.str)`${schPath}${(0, util_1.getErrorPath)(schemaPath, util_1.Type.Str)}`;
    }
    return [E.schemaPath, schPath];
  }
  function extraErrorProps(cxt, { params, message }, keyValues) {
    const { keyword, data, schemaValue, it } = cxt;
    const { opts, propertyName, topSchemaRef, schemaPath } = it;
    keyValues.push([E.keyword, keyword], [E.params, typeof params == "function" ? params(cxt) : params || (0, codegen_1._)`{}`]);
    if (opts.messages) {
      keyValues.push([E.message, typeof message == "function" ? message(cxt) : message]);
    }
    if (opts.verbose) {
      keyValues.push([E.schema, schemaValue], [E.parentSchema, (0, codegen_1._)`${topSchemaRef}${schemaPath}`], [names_1.default.data, data]);
    }
    if (propertyName)
      keyValues.push([E.propertyName, propertyName]);
  }
});

// ../../node_modules/ajv/dist/compile/validate/boolSchema.js
var require_boolSchema = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.boolOrEmptySchema = exports.topBoolOrEmptySchema = undefined;
  var errors_1 = require_errors();
  var codegen_1 = require_codegen();
  var names_1 = require_names();
  var boolError = {
    message: "boolean schema is false"
  };
  function topBoolOrEmptySchema(it) {
    const { gen, schema, validateName } = it;
    if (schema === false) {
      falseSchemaError(it, false);
    } else if (typeof schema == "object" && schema.$async === true) {
      gen.return(names_1.default.data);
    } else {
      gen.assign((0, codegen_1._)`${validateName}.errors`, null);
      gen.return(true);
    }
  }
  exports.topBoolOrEmptySchema = topBoolOrEmptySchema;
  function boolOrEmptySchema(it, valid) {
    const { gen, schema } = it;
    if (schema === false) {
      gen.var(valid, false);
      falseSchemaError(it);
    } else {
      gen.var(valid, true);
    }
  }
  exports.boolOrEmptySchema = boolOrEmptySchema;
  function falseSchemaError(it, overrideAllErrors) {
    const { gen, data } = it;
    const cxt = {
      gen,
      keyword: "false schema",
      data,
      schema: false,
      schemaCode: false,
      schemaValue: false,
      params: {},
      it
    };
    (0, errors_1.reportError)(cxt, boolError, undefined, overrideAllErrors);
  }
});

// ../../node_modules/ajv/dist/compile/rules.js
var require_rules = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.getRules = exports.isJSONType = undefined;
  var _jsonTypes = ["string", "number", "integer", "boolean", "null", "object", "array"];
  var jsonTypes = new Set(_jsonTypes);
  function isJSONType(x) {
    return typeof x == "string" && jsonTypes.has(x);
  }
  exports.isJSONType = isJSONType;
  function getRules() {
    const groups = {
      number: { type: "number", rules: [] },
      string: { type: "string", rules: [] },
      array: { type: "array", rules: [] },
      object: { type: "object", rules: [] }
    };
    return {
      types: { ...groups, integer: true, boolean: true, null: true },
      rules: [{ rules: [] }, groups.number, groups.string, groups.array, groups.object],
      post: { rules: [] },
      all: {},
      keywords: {}
    };
  }
  exports.getRules = getRules;
});

// ../../node_modules/ajv/dist/compile/validate/applicability.js
var require_applicability = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.shouldUseRule = exports.shouldUseGroup = exports.schemaHasRulesForType = undefined;
  function schemaHasRulesForType({ schema, self }, type) {
    const group = self.RULES.types[type];
    return group && group !== true && shouldUseGroup(schema, group);
  }
  exports.schemaHasRulesForType = schemaHasRulesForType;
  function shouldUseGroup(schema, group) {
    return group.rules.some((rule) => shouldUseRule(schema, rule));
  }
  exports.shouldUseGroup = shouldUseGroup;
  function shouldUseRule(schema, rule) {
    var _a;
    return schema[rule.keyword] !== undefined || ((_a = rule.definition.implements) === null || _a === undefined ? undefined : _a.some((kwd) => schema[kwd] !== undefined));
  }
  exports.shouldUseRule = shouldUseRule;
});

// ../../node_modules/ajv/dist/compile/validate/dataType.js
var require_dataType = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.reportTypeError = exports.checkDataTypes = exports.checkDataType = exports.coerceAndCheckDataType = exports.getJSONTypes = exports.getSchemaTypes = exports.DataType = undefined;
  var rules_1 = require_rules();
  var applicability_1 = require_applicability();
  var errors_1 = require_errors();
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var DataType;
  (function(DataType) {
    DataType[DataType["Correct"] = 0] = "Correct";
    DataType[DataType["Wrong"] = 1] = "Wrong";
  })(DataType || (exports.DataType = DataType = {}));
  function getSchemaTypes(schema) {
    const types = getJSONTypes(schema.type);
    const hasNull = types.includes("null");
    if (hasNull) {
      if (schema.nullable === false)
        throw new Error("type: null contradicts nullable: false");
    } else {
      if (!types.length && schema.nullable !== undefined) {
        throw new Error('"nullable" cannot be used without "type"');
      }
      if (schema.nullable === true)
        types.push("null");
    }
    return types;
  }
  exports.getSchemaTypes = getSchemaTypes;
  function getJSONTypes(ts) {
    const types = Array.isArray(ts) ? ts : ts ? [ts] : [];
    if (types.every(rules_1.isJSONType))
      return types;
    throw new Error("type must be JSONType or JSONType[]: " + types.join(","));
  }
  exports.getJSONTypes = getJSONTypes;
  function coerceAndCheckDataType(it, types) {
    const { gen, data, opts } = it;
    const coerceTo = coerceToTypes(types, opts.coerceTypes);
    const checkTypes = types.length > 0 && !(coerceTo.length === 0 && types.length === 1 && (0, applicability_1.schemaHasRulesForType)(it, types[0]));
    if (checkTypes) {
      const wrongType = checkDataTypes(types, data, opts.strictNumbers, DataType.Wrong);
      gen.if(wrongType, () => {
        if (coerceTo.length)
          coerceData(it, types, coerceTo);
        else
          reportTypeError(it);
      });
    }
    return checkTypes;
  }
  exports.coerceAndCheckDataType = coerceAndCheckDataType;
  var COERCIBLE = new Set(["string", "number", "integer", "boolean", "null"]);
  function coerceToTypes(types, coerceTypes) {
    return coerceTypes ? types.filter((t) => COERCIBLE.has(t) || coerceTypes === "array" && t === "array") : [];
  }
  function coerceData(it, types, coerceTo) {
    const { gen, data, opts } = it;
    const dataType = gen.let("dataType", (0, codegen_1._)`typeof ${data}`);
    const coerced = gen.let("coerced", (0, codegen_1._)`undefined`);
    if (opts.coerceTypes === "array") {
      gen.if((0, codegen_1._)`${dataType} == 'object' && Array.isArray(${data}) && ${data}.length == 1`, () => gen.assign(data, (0, codegen_1._)`${data}[0]`).assign(dataType, (0, codegen_1._)`typeof ${data}`).if(checkDataTypes(types, data, opts.strictNumbers), () => gen.assign(coerced, data)));
    }
    gen.if((0, codegen_1._)`${coerced} !== undefined`);
    for (const t of coerceTo) {
      if (COERCIBLE.has(t) || t === "array" && opts.coerceTypes === "array") {
        coerceSpecificType(t);
      }
    }
    gen.else();
    reportTypeError(it);
    gen.endIf();
    gen.if((0, codegen_1._)`${coerced} !== undefined`, () => {
      gen.assign(data, coerced);
      assignParentData(it, coerced);
    });
    function coerceSpecificType(t) {
      switch (t) {
        case "string":
          gen.elseIf((0, codegen_1._)`${dataType} == "number" || ${dataType} == "boolean"`).assign(coerced, (0, codegen_1._)`"" + ${data}`).elseIf((0, codegen_1._)`${data} === null`).assign(coerced, (0, codegen_1._)`""`);
          return;
        case "number":
          gen.elseIf((0, codegen_1._)`${dataType} == "boolean" || ${data} === null
              || (${dataType} == "string" && ${data} && ${data} == +${data})`).assign(coerced, (0, codegen_1._)`+${data}`);
          return;
        case "integer":
          gen.elseIf((0, codegen_1._)`${dataType} === "boolean" || ${data} === null
              || (${dataType} === "string" && ${data} && ${data} == +${data} && !(${data} % 1))`).assign(coerced, (0, codegen_1._)`+${data}`);
          return;
        case "boolean":
          gen.elseIf((0, codegen_1._)`${data} === "false" || ${data} === 0 || ${data} === null`).assign(coerced, false).elseIf((0, codegen_1._)`${data} === "true" || ${data} === 1`).assign(coerced, true);
          return;
        case "null":
          gen.elseIf((0, codegen_1._)`${data} === "" || ${data} === 0 || ${data} === false`);
          gen.assign(coerced, null);
          return;
        case "array":
          gen.elseIf((0, codegen_1._)`${dataType} === "string" || ${dataType} === "number"
              || ${dataType} === "boolean" || ${data} === null`).assign(coerced, (0, codegen_1._)`[${data}]`);
      }
    }
  }
  function assignParentData({ gen, parentData, parentDataProperty }, expr) {
    gen.if((0, codegen_1._)`${parentData} !== undefined`, () => gen.assign((0, codegen_1._)`${parentData}[${parentDataProperty}]`, expr));
  }
  function checkDataType(dataType, data, strictNums, correct = DataType.Correct) {
    const EQ = correct === DataType.Correct ? codegen_1.operators.EQ : codegen_1.operators.NEQ;
    let cond;
    switch (dataType) {
      case "null":
        return (0, codegen_1._)`${data} ${EQ} null`;
      case "array":
        cond = (0, codegen_1._)`Array.isArray(${data})`;
        break;
      case "object":
        cond = (0, codegen_1._)`${data} && typeof ${data} == "object" && !Array.isArray(${data})`;
        break;
      case "integer":
        cond = numCond((0, codegen_1._)`!(${data} % 1) && !isNaN(${data})`);
        break;
      case "number":
        cond = numCond();
        break;
      default:
        return (0, codegen_1._)`typeof ${data} ${EQ} ${dataType}`;
    }
    return correct === DataType.Correct ? cond : (0, codegen_1.not)(cond);
    function numCond(_cond = codegen_1.nil) {
      return (0, codegen_1.and)((0, codegen_1._)`typeof ${data} == "number"`, _cond, strictNums ? (0, codegen_1._)`isFinite(${data})` : codegen_1.nil);
    }
  }
  exports.checkDataType = checkDataType;
  function checkDataTypes(dataTypes, data, strictNums, correct) {
    if (dataTypes.length === 1) {
      return checkDataType(dataTypes[0], data, strictNums, correct);
    }
    let cond;
    const types = (0, util_1.toHash)(dataTypes);
    if (types.array && types.object) {
      const notObj = (0, codegen_1._)`typeof ${data} != "object"`;
      cond = types.null ? notObj : (0, codegen_1._)`!${data} || ${notObj}`;
      delete types.null;
      delete types.array;
      delete types.object;
    } else {
      cond = codegen_1.nil;
    }
    if (types.number)
      delete types.integer;
    for (const t in types)
      cond = (0, codegen_1.and)(cond, checkDataType(t, data, strictNums, correct));
    return cond;
  }
  exports.checkDataTypes = checkDataTypes;
  var typeError = {
    message: ({ schema }) => `must be ${schema}`,
    params: ({ schema, schemaValue }) => typeof schema == "string" ? (0, codegen_1._)`{type: ${schema}}` : (0, codegen_1._)`{type: ${schemaValue}}`
  };
  function reportTypeError(it) {
    const cxt = getTypeErrorContext(it);
    (0, errors_1.reportError)(cxt, typeError);
  }
  exports.reportTypeError = reportTypeError;
  function getTypeErrorContext(it) {
    const { gen, data, schema } = it;
    const schemaCode = (0, util_1.schemaRefOrVal)(it, schema, "type");
    return {
      gen,
      keyword: "type",
      data,
      schema: schema.type,
      schemaCode,
      schemaValue: schemaCode,
      parentSchema: schema,
      params: {},
      it
    };
  }
});

// ../../node_modules/ajv/dist/compile/validate/defaults.js
var require_defaults = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.assignDefaults = undefined;
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  function assignDefaults(it, ty) {
    const { properties, items } = it.schema;
    if (ty === "object" && properties) {
      for (const key in properties) {
        assignDefault(it, key, properties[key].default);
      }
    } else if (ty === "array" && Array.isArray(items)) {
      items.forEach((sch, i) => assignDefault(it, i, sch.default));
    }
  }
  exports.assignDefaults = assignDefaults;
  function assignDefault(it, prop, defaultValue) {
    const { gen, compositeRule, data, opts } = it;
    if (defaultValue === undefined)
      return;
    const childData = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(prop)}`;
    if (compositeRule) {
      (0, util_1.checkStrictMode)(it, `default is ignored for: ${childData}`);
      return;
    }
    let condition = (0, codegen_1._)`${childData} === undefined`;
    if (opts.useDefaults === "empty") {
      condition = (0, codegen_1._)`${condition} || ${childData} === null || ${childData} === ""`;
    }
    gen.if(condition, (0, codegen_1._)`${childData} = ${(0, codegen_1.stringify)(defaultValue)}`);
  }
});

// ../../node_modules/ajv/dist/vocabularies/code.js
var require_code2 = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.validateUnion = exports.validateArray = exports.usePattern = exports.callValidateCode = exports.schemaProperties = exports.allSchemaProperties = exports.noPropertyInData = exports.propertyInData = exports.isOwnProperty = exports.hasPropFunc = exports.reportMissingProp = exports.checkMissingProp = exports.checkReportMissingProp = undefined;
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var names_1 = require_names();
  var util_2 = require_util();
  function checkReportMissingProp(cxt, prop) {
    const { gen, data, it } = cxt;
    gen.if(noPropertyInData(gen, data, prop, it.opts.ownProperties), () => {
      cxt.setParams({ missingProperty: (0, codegen_1._)`${prop}` }, true);
      cxt.error();
    });
  }
  exports.checkReportMissingProp = checkReportMissingProp;
  function checkMissingProp({ gen, data, it: { opts } }, properties, missing) {
    return (0, codegen_1.or)(...properties.map((prop) => (0, codegen_1.and)(noPropertyInData(gen, data, prop, opts.ownProperties), (0, codegen_1._)`${missing} = ${prop}`)));
  }
  exports.checkMissingProp = checkMissingProp;
  function reportMissingProp(cxt, missing) {
    cxt.setParams({ missingProperty: missing }, true);
    cxt.error();
  }
  exports.reportMissingProp = reportMissingProp;
  function hasPropFunc(gen) {
    return gen.scopeValue("func", {
      ref: Object.prototype.hasOwnProperty,
      code: (0, codegen_1._)`Object.prototype.hasOwnProperty`
    });
  }
  exports.hasPropFunc = hasPropFunc;
  function isOwnProperty(gen, data, property) {
    return (0, codegen_1._)`${hasPropFunc(gen)}.call(${data}, ${property})`;
  }
  exports.isOwnProperty = isOwnProperty;
  function propertyInData(gen, data, property, ownProperties) {
    const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} !== undefined`;
    return ownProperties ? (0, codegen_1._)`${cond} && ${isOwnProperty(gen, data, property)}` : cond;
  }
  exports.propertyInData = propertyInData;
  function noPropertyInData(gen, data, property, ownProperties) {
    const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} === undefined`;
    return ownProperties ? (0, codegen_1.or)(cond, (0, codegen_1.not)(isOwnProperty(gen, data, property))) : cond;
  }
  exports.noPropertyInData = noPropertyInData;
  function allSchemaProperties(schemaMap) {
    return schemaMap ? Object.keys(schemaMap).filter((p) => p !== "__proto__") : [];
  }
  exports.allSchemaProperties = allSchemaProperties;
  function schemaProperties(it, schemaMap) {
    return allSchemaProperties(schemaMap).filter((p) => !(0, util_1.alwaysValidSchema)(it, schemaMap[p]));
  }
  exports.schemaProperties = schemaProperties;
  function callValidateCode({ schemaCode, data, it: { gen, topSchemaRef, schemaPath, errorPath }, it }, func, context, passSchema) {
    const dataAndSchema = passSchema ? (0, codegen_1._)`${schemaCode}, ${data}, ${topSchemaRef}${schemaPath}` : data;
    const valCxt = [
      [names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, errorPath)],
      [names_1.default.parentData, it.parentData],
      [names_1.default.parentDataProperty, it.parentDataProperty],
      [names_1.default.rootData, names_1.default.rootData]
    ];
    if (it.opts.dynamicRef)
      valCxt.push([names_1.default.dynamicAnchors, names_1.default.dynamicAnchors]);
    const args = (0, codegen_1._)`${dataAndSchema}, ${gen.object(...valCxt)}`;
    return context !== codegen_1.nil ? (0, codegen_1._)`${func}.call(${context}, ${args})` : (0, codegen_1._)`${func}(${args})`;
  }
  exports.callValidateCode = callValidateCode;
  var newRegExp = (0, codegen_1._)`new RegExp`;
  function usePattern({ gen, it: { opts } }, pattern) {
    const u = opts.unicodeRegExp ? "u" : "";
    const { regExp } = opts.code;
    const rx = regExp(pattern, u);
    return gen.scopeValue("pattern", {
      key: rx.toString(),
      ref: rx,
      code: (0, codegen_1._)`${regExp.code === "new RegExp" ? newRegExp : (0, util_2.useFunc)(gen, regExp)}(${pattern}, ${u})`
    });
  }
  exports.usePattern = usePattern;
  function validateArray(cxt) {
    const { gen, data, keyword, it } = cxt;
    const valid = gen.name("valid");
    if (it.allErrors) {
      const validArr = gen.let("valid", true);
      validateItems(() => gen.assign(validArr, false));
      return validArr;
    }
    gen.var(valid, true);
    validateItems(() => gen.break());
    return valid;
    function validateItems(notValid) {
      const len = gen.const("len", (0, codegen_1._)`${data}.length`);
      gen.forRange("i", 0, len, (i) => {
        cxt.subschema({
          keyword,
          dataProp: i,
          dataPropType: util_1.Type.Num
        }, valid);
        gen.if((0, codegen_1.not)(valid), notValid);
      });
    }
  }
  exports.validateArray = validateArray;
  function validateUnion(cxt) {
    const { gen, schema, keyword, it } = cxt;
    if (!Array.isArray(schema))
      throw new Error("ajv implementation error");
    const alwaysValid = schema.some((sch) => (0, util_1.alwaysValidSchema)(it, sch));
    if (alwaysValid && !it.opts.unevaluated)
      return;
    const valid = gen.let("valid", false);
    const schValid = gen.name("_valid");
    gen.block(() => schema.forEach((_sch, i) => {
      const schCxt = cxt.subschema({
        keyword,
        schemaProp: i,
        compositeRule: true
      }, schValid);
      gen.assign(valid, (0, codegen_1._)`${valid} || ${schValid}`);
      const merged = cxt.mergeValidEvaluated(schCxt, schValid);
      if (!merged)
        gen.if((0, codegen_1.not)(valid));
    }));
    cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
  }
  exports.validateUnion = validateUnion;
});

// ../../node_modules/ajv/dist/compile/validate/keyword.js
var require_keyword = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.validateKeywordUsage = exports.validSchemaType = exports.funcKeywordCode = exports.macroKeywordCode = undefined;
  var codegen_1 = require_codegen();
  var names_1 = require_names();
  var code_1 = require_code2();
  var errors_1 = require_errors();
  function macroKeywordCode(cxt, def) {
    const { gen, keyword, schema, parentSchema, it } = cxt;
    const macroSchema = def.macro.call(it.self, schema, parentSchema, it);
    const schemaRef = useKeyword(gen, keyword, macroSchema);
    if (it.opts.validateSchema !== false)
      it.self.validateSchema(macroSchema, true);
    const valid = gen.name("valid");
    cxt.subschema({
      schema: macroSchema,
      schemaPath: codegen_1.nil,
      errSchemaPath: `${it.errSchemaPath}/${keyword}`,
      topSchemaRef: schemaRef,
      compositeRule: true
    }, valid);
    cxt.pass(valid, () => cxt.error(true));
  }
  exports.macroKeywordCode = macroKeywordCode;
  function funcKeywordCode(cxt, def) {
    var _a;
    const { gen, keyword, schema, parentSchema, $data, it } = cxt;
    checkAsyncKeyword(it, def);
    const validate = !$data && def.compile ? def.compile.call(it.self, schema, parentSchema, it) : def.validate;
    const validateRef = useKeyword(gen, keyword, validate);
    const valid = gen.let("valid");
    cxt.block$data(valid, validateKeyword);
    cxt.ok((_a = def.valid) !== null && _a !== undefined ? _a : valid);
    function validateKeyword() {
      if (def.errors === false) {
        assignValid();
        if (def.modifying)
          modifyData(cxt);
        reportErrs(() => cxt.error());
      } else {
        const ruleErrs = def.async ? validateAsync() : validateSync();
        if (def.modifying)
          modifyData(cxt);
        reportErrs(() => addErrs(cxt, ruleErrs));
      }
    }
    function validateAsync() {
      const ruleErrs = gen.let("ruleErrs", null);
      gen.try(() => assignValid((0, codegen_1._)`await `), (e) => gen.assign(valid, false).if((0, codegen_1._)`${e} instanceof ${it.ValidationError}`, () => gen.assign(ruleErrs, (0, codegen_1._)`${e}.errors`), () => gen.throw(e)));
      return ruleErrs;
    }
    function validateSync() {
      const validateErrs = (0, codegen_1._)`${validateRef}.errors`;
      gen.assign(validateErrs, null);
      assignValid(codegen_1.nil);
      return validateErrs;
    }
    function assignValid(_await = def.async ? (0, codegen_1._)`await ` : codegen_1.nil) {
      const passCxt = it.opts.passContext ? names_1.default.this : names_1.default.self;
      const passSchema = !(("compile" in def) && !$data || def.schema === false);
      gen.assign(valid, (0, codegen_1._)`${_await}${(0, code_1.callValidateCode)(cxt, validateRef, passCxt, passSchema)}`, def.modifying);
    }
    function reportErrs(errors) {
      var _a;
      gen.if((0, codegen_1.not)((_a = def.valid) !== null && _a !== undefined ? _a : valid), errors);
    }
  }
  exports.funcKeywordCode = funcKeywordCode;
  function modifyData(cxt) {
    const { gen, data, it } = cxt;
    gen.if(it.parentData, () => gen.assign(data, (0, codegen_1._)`${it.parentData}[${it.parentDataProperty}]`));
  }
  function addErrs(cxt, errs) {
    const { gen } = cxt;
    gen.if((0, codegen_1._)`Array.isArray(${errs})`, () => {
      gen.assign(names_1.default.vErrors, (0, codegen_1._)`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`).assign(names_1.default.errors, (0, codegen_1._)`${names_1.default.vErrors}.length`);
      (0, errors_1.extendErrors)(cxt);
    }, () => cxt.error());
  }
  function checkAsyncKeyword({ schemaEnv }, def) {
    if (def.async && !schemaEnv.$async)
      throw new Error("async keyword in sync schema");
  }
  function useKeyword(gen, keyword, result) {
    if (result === undefined)
      throw new Error(`keyword "${keyword}" failed to compile`);
    return gen.scopeValue("keyword", typeof result == "function" ? { ref: result } : { ref: result, code: (0, codegen_1.stringify)(result) });
  }
  function validSchemaType(schema, schemaType, allowUndefined = false) {
    return !schemaType.length || schemaType.some((st) => st === "array" ? Array.isArray(schema) : st === "object" ? schema && typeof schema == "object" && !Array.isArray(schema) : typeof schema == st || allowUndefined && typeof schema == "undefined");
  }
  exports.validSchemaType = validSchemaType;
  function validateKeywordUsage({ schema, opts, self, errSchemaPath }, def, keyword) {
    if (Array.isArray(def.keyword) ? !def.keyword.includes(keyword) : def.keyword !== keyword) {
      throw new Error("ajv implementation error");
    }
    const deps = def.dependencies;
    if (deps === null || deps === undefined ? undefined : deps.some((kwd) => !Object.prototype.hasOwnProperty.call(schema, kwd))) {
      throw new Error(`parent schema must have dependencies of ${keyword}: ${deps.join(",")}`);
    }
    if (def.validateSchema) {
      const valid = def.validateSchema(schema[keyword]);
      if (!valid) {
        const msg = `keyword "${keyword}" value is invalid at path "${errSchemaPath}": ` + self.errorsText(def.validateSchema.errors);
        if (opts.validateSchema === "log")
          self.logger.error(msg);
        else
          throw new Error(msg);
      }
    }
  }
  exports.validateKeywordUsage = validateKeywordUsage;
});

// ../../node_modules/ajv/dist/compile/validate/subschema.js
var require_subschema = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.extendSubschemaMode = exports.extendSubschemaData = exports.getSubschema = undefined;
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  function getSubschema(it, { keyword, schemaProp, schema, schemaPath, errSchemaPath, topSchemaRef }) {
    if (keyword !== undefined && schema !== undefined) {
      throw new Error('both "keyword" and "schema" passed, only one allowed');
    }
    if (keyword !== undefined) {
      const sch = it.schema[keyword];
      return schemaProp === undefined ? {
        schema: sch,
        schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}`,
        errSchemaPath: `${it.errSchemaPath}/${keyword}`
      } : {
        schema: sch[schemaProp],
        schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}${(0, codegen_1.getProperty)(schemaProp)}`,
        errSchemaPath: `${it.errSchemaPath}/${keyword}/${(0, util_1.escapeFragment)(schemaProp)}`
      };
    }
    if (schema !== undefined) {
      if (schemaPath === undefined || errSchemaPath === undefined || topSchemaRef === undefined) {
        throw new Error('"schemaPath", "errSchemaPath" and "topSchemaRef" are required with "schema"');
      }
      return {
        schema,
        schemaPath,
        topSchemaRef,
        errSchemaPath
      };
    }
    throw new Error('either "keyword" or "schema" must be passed');
  }
  exports.getSubschema = getSubschema;
  function extendSubschemaData(subschema, it, { dataProp, dataPropType: dpType, data, dataTypes, propertyName }) {
    if (data !== undefined && dataProp !== undefined) {
      throw new Error('both "data" and "dataProp" passed, only one allowed');
    }
    const { gen } = it;
    if (dataProp !== undefined) {
      const { errorPath, dataPathArr, opts } = it;
      const nextData = gen.let("data", (0, codegen_1._)`${it.data}${(0, codegen_1.getProperty)(dataProp)}`, true);
      dataContextProps(nextData);
      subschema.errorPath = (0, codegen_1.str)`${errorPath}${(0, util_1.getErrorPath)(dataProp, dpType, opts.jsPropertySyntax)}`;
      subschema.parentDataProperty = (0, codegen_1._)`${dataProp}`;
      subschema.dataPathArr = [...dataPathArr, subschema.parentDataProperty];
    }
    if (data !== undefined) {
      const nextData = data instanceof codegen_1.Name ? data : gen.let("data", data, true);
      dataContextProps(nextData);
      if (propertyName !== undefined)
        subschema.propertyName = propertyName;
    }
    if (dataTypes)
      subschema.dataTypes = dataTypes;
    function dataContextProps(_nextData) {
      subschema.data = _nextData;
      subschema.dataLevel = it.dataLevel + 1;
      subschema.dataTypes = [];
      it.definedProperties = new Set;
      subschema.parentData = it.data;
      subschema.dataNames = [...it.dataNames, _nextData];
    }
  }
  exports.extendSubschemaData = extendSubschemaData;
  function extendSubschemaMode(subschema, { jtdDiscriminator, jtdMetadata, compositeRule, createErrors, allErrors }) {
    if (compositeRule !== undefined)
      subschema.compositeRule = compositeRule;
    if (createErrors !== undefined)
      subschema.createErrors = createErrors;
    if (allErrors !== undefined)
      subschema.allErrors = allErrors;
    subschema.jtdDiscriminator = jtdDiscriminator;
    subschema.jtdMetadata = jtdMetadata;
  }
  exports.extendSubschemaMode = extendSubschemaMode;
});

// ../../node_modules/fast-deep-equal/index.js
var require_fast_deep_equal = __commonJS(function(exports, module) {
  module.exports = function equal(a, b) {
    if (a === b)
      return true;
    if (a && b && typeof a == "object" && typeof b == "object") {
      if (a.constructor !== b.constructor)
        return false;
      var length, i, keys;
      if (Array.isArray(a)) {
        length = a.length;
        if (length != b.length)
          return false;
        for (i = length;i-- !== 0; )
          if (!equal(a[i], b[i]))
            return false;
        return true;
      }
      if (a.constructor === RegExp)
        return a.source === b.source && a.flags === b.flags;
      if (a.valueOf !== Object.prototype.valueOf)
        return a.valueOf() === b.valueOf();
      if (a.toString !== Object.prototype.toString)
        return a.toString() === b.toString();
      keys = Object.keys(a);
      length = keys.length;
      if (length !== Object.keys(b).length)
        return false;
      for (i = length;i-- !== 0; )
        if (!Object.prototype.hasOwnProperty.call(b, keys[i]))
          return false;
      for (i = length;i-- !== 0; ) {
        var key = keys[i];
        if (!equal(a[key], b[key]))
          return false;
      }
      return true;
    }
    return a !== a && b !== b;
  };
});

// ../../node_modules/json-schema-traverse/index.js
var require_json_schema_traverse = __commonJS(function(exports, module) {
  var traverse = module.exports = function(schema, opts, cb) {
    if (typeof opts == "function") {
      cb = opts;
      opts = {};
    }
    cb = opts.cb || cb;
    var pre = typeof cb == "function" ? cb : cb.pre || function() {};
    var post = cb.post || function() {};
    _traverse(opts, pre, post, schema, "", schema);
  };
  traverse.keywords = {
    additionalItems: true,
    items: true,
    contains: true,
    additionalProperties: true,
    propertyNames: true,
    not: true,
    if: true,
    then: true,
    else: true
  };
  traverse.arrayKeywords = {
    items: true,
    allOf: true,
    anyOf: true,
    oneOf: true
  };
  traverse.propsKeywords = {
    $defs: true,
    definitions: true,
    properties: true,
    patternProperties: true,
    dependencies: true
  };
  traverse.skipKeywords = {
    default: true,
    enum: true,
    const: true,
    required: true,
    maximum: true,
    minimum: true,
    exclusiveMaximum: true,
    exclusiveMinimum: true,
    multipleOf: true,
    maxLength: true,
    minLength: true,
    pattern: true,
    format: true,
    maxItems: true,
    minItems: true,
    uniqueItems: true,
    maxProperties: true,
    minProperties: true
  };
  function _traverse(opts, pre, post, schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex) {
    if (schema && typeof schema == "object" && !Array.isArray(schema)) {
      pre(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
      for (var key in schema) {
        var sch = schema[key];
        if (Array.isArray(sch)) {
          if (key in traverse.arrayKeywords) {
            for (var i = 0;i < sch.length; i++)
              _traverse(opts, pre, post, sch[i], jsonPtr + "/" + key + "/" + i, rootSchema, jsonPtr, key, schema, i);
          }
        } else if (key in traverse.propsKeywords) {
          if (sch && typeof sch == "object") {
            for (var prop in sch)
              _traverse(opts, pre, post, sch[prop], jsonPtr + "/" + key + "/" + escapeJsonPtr(prop), rootSchema, jsonPtr, key, schema, prop);
          }
        } else if (key in traverse.keywords || opts.allKeys && !(key in traverse.skipKeywords)) {
          _traverse(opts, pre, post, sch, jsonPtr + "/" + key, rootSchema, jsonPtr, key, schema);
        }
      }
      post(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
    }
  }
  function escapeJsonPtr(str) {
    return str.replace(/~/g, "~0").replace(/\//g, "~1");
  }
});

// ../../node_modules/ajv/dist/compile/resolve.js
var require_resolve = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.getSchemaRefs = exports.resolveUrl = exports.normalizeId = exports._getFullPath = exports.getFullPath = exports.inlineRef = undefined;
  var util_1 = require_util();
  var equal = require_fast_deep_equal();
  var traverse = require_json_schema_traverse();
  var SIMPLE_INLINED = new Set([
    "type",
    "format",
    "pattern",
    "maxLength",
    "minLength",
    "maxProperties",
    "minProperties",
    "maxItems",
    "minItems",
    "maximum",
    "minimum",
    "uniqueItems",
    "multipleOf",
    "required",
    "enum",
    "const"
  ]);
  function inlineRef(schema, limit = true) {
    if (typeof schema == "boolean")
      return true;
    if (limit === true)
      return !hasRef(schema);
    if (!limit)
      return false;
    return countKeys(schema) <= limit;
  }
  exports.inlineRef = inlineRef;
  var REF_KEYWORDS = new Set([
    "$ref",
    "$recursiveRef",
    "$recursiveAnchor",
    "$dynamicRef",
    "$dynamicAnchor"
  ]);
  function hasRef(schema) {
    for (const key in schema) {
      if (REF_KEYWORDS.has(key))
        return true;
      const sch = schema[key];
      if (Array.isArray(sch) && sch.some(hasRef))
        return true;
      if (typeof sch == "object" && hasRef(sch))
        return true;
    }
    return false;
  }
  function countKeys(schema) {
    let count = 0;
    for (const key in schema) {
      if (key === "$ref")
        return Infinity;
      count++;
      if (SIMPLE_INLINED.has(key))
        continue;
      if (typeof schema[key] == "object") {
        (0, util_1.eachItem)(schema[key], (sch) => count += countKeys(sch));
      }
      if (count === Infinity)
        return Infinity;
    }
    return count;
  }
  function getFullPath(resolver, id = "", normalize) {
    if (normalize !== false)
      id = normalizeId(id);
    const p = resolver.parse(id);
    return _getFullPath(resolver, p);
  }
  exports.getFullPath = getFullPath;
  function _getFullPath(resolver, p) {
    const serialized = resolver.serialize(p);
    return serialized.split("#")[0] + "#";
  }
  exports._getFullPath = _getFullPath;
  var TRAILING_SLASH_HASH = /#\/?$/;
  function normalizeId(id) {
    return id ? id.replace(TRAILING_SLASH_HASH, "") : "";
  }
  exports.normalizeId = normalizeId;
  function resolveUrl(resolver, baseId, id) {
    id = normalizeId(id);
    return resolver.resolve(baseId, id);
  }
  exports.resolveUrl = resolveUrl;
  var ANCHOR = /^[a-z_][-a-z0-9._]*$/i;
  function getSchemaRefs(schema, baseId) {
    if (typeof schema == "boolean")
      return {};
    const { schemaId, uriResolver } = this.opts;
    const schId = normalizeId(schema[schemaId] || baseId);
    const baseIds = { "": schId };
    const pathPrefix = getFullPath(uriResolver, schId, false);
    const localRefs = {};
    const schemaRefs = new Set;
    traverse(schema, { allKeys: true }, (sch, jsonPtr, _, parentJsonPtr) => {
      if (parentJsonPtr === undefined)
        return;
      const fullPath = pathPrefix + jsonPtr;
      let innerBaseId = baseIds[parentJsonPtr];
      if (typeof sch[schemaId] == "string")
        innerBaseId = addRef.call(this, sch[schemaId]);
      addAnchor.call(this, sch.$anchor);
      addAnchor.call(this, sch.$dynamicAnchor);
      baseIds[jsonPtr] = innerBaseId;
      function addRef(ref) {
        const _resolve = this.opts.uriResolver.resolve;
        ref = normalizeId(innerBaseId ? _resolve(innerBaseId, ref) : ref);
        if (schemaRefs.has(ref))
          throw ambiguos(ref);
        schemaRefs.add(ref);
        let schOrRef = this.refs[ref];
        if (typeof schOrRef == "string")
          schOrRef = this.refs[schOrRef];
        if (typeof schOrRef == "object") {
          checkAmbiguosRef(sch, schOrRef.schema, ref);
        } else if (ref !== normalizeId(fullPath)) {
          if (ref[0] === "#") {
            checkAmbiguosRef(sch, localRefs[ref], ref);
            localRefs[ref] = sch;
          } else {
            this.refs[ref] = fullPath;
          }
        }
        return ref;
      }
      function addAnchor(anchor) {
        if (typeof anchor == "string") {
          if (!ANCHOR.test(anchor))
            throw new Error(`invalid anchor "${anchor}"`);
          addRef.call(this, `#${anchor}`);
        }
      }
    });
    return localRefs;
    function checkAmbiguosRef(sch1, sch2, ref) {
      if (sch2 !== undefined && !equal(sch1, sch2))
        throw ambiguos(ref);
    }
    function ambiguos(ref) {
      return new Error(`reference "${ref}" resolves to more than one schema`);
    }
  }
  exports.getSchemaRefs = getSchemaRefs;
});

// ../../node_modules/ajv/dist/compile/validate/index.js
var require_validate = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.getData = exports.KeywordCxt = exports.validateFunctionCode = undefined;
  var boolSchema_1 = require_boolSchema();
  var dataType_1 = require_dataType();
  var applicability_1 = require_applicability();
  var dataType_2 = require_dataType();
  var defaults_1 = require_defaults();
  var keyword_1 = require_keyword();
  var subschema_1 = require_subschema();
  var codegen_1 = require_codegen();
  var names_1 = require_names();
  var resolve_1 = require_resolve();
  var util_1 = require_util();
  var errors_1 = require_errors();
  function validateFunctionCode(it) {
    if (isSchemaObj(it)) {
      checkKeywords(it);
      if (schemaCxtHasRules(it)) {
        topSchemaObjCode(it);
        return;
      }
    }
    validateFunction(it, () => (0, boolSchema_1.topBoolOrEmptySchema)(it));
  }
  exports.validateFunctionCode = validateFunctionCode;
  function validateFunction({ gen, validateName, schema, schemaEnv, opts }, body) {
    if (opts.code.es5) {
      gen.func(validateName, (0, codegen_1._)`${names_1.default.data}, ${names_1.default.valCxt}`, schemaEnv.$async, () => {
        gen.code((0, codegen_1._)`"use strict"; ${funcSourceUrl(schema, opts)}`);
        destructureValCxtES5(gen, opts);
        gen.code(body);
      });
    } else {
      gen.func(validateName, (0, codegen_1._)`${names_1.default.data}, ${destructureValCxt(opts)}`, schemaEnv.$async, () => gen.code(funcSourceUrl(schema, opts)).code(body));
    }
  }
  function destructureValCxt(opts) {
    return (0, codegen_1._)`{${names_1.default.instancePath}="", ${names_1.default.parentData}, ${names_1.default.parentDataProperty}, ${names_1.default.rootData}=${names_1.default.data}${opts.dynamicRef ? (0, codegen_1._)`, ${names_1.default.dynamicAnchors}={}` : codegen_1.nil}}={}`;
  }
  function destructureValCxtES5(gen, opts) {
    gen.if(names_1.default.valCxt, () => {
      gen.var(names_1.default.instancePath, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.instancePath}`);
      gen.var(names_1.default.parentData, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.parentData}`);
      gen.var(names_1.default.parentDataProperty, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.parentDataProperty}`);
      gen.var(names_1.default.rootData, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.rootData}`);
      if (opts.dynamicRef)
        gen.var(names_1.default.dynamicAnchors, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.dynamicAnchors}`);
    }, () => {
      gen.var(names_1.default.instancePath, (0, codegen_1._)`""`);
      gen.var(names_1.default.parentData, (0, codegen_1._)`undefined`);
      gen.var(names_1.default.parentDataProperty, (0, codegen_1._)`undefined`);
      gen.var(names_1.default.rootData, names_1.default.data);
      if (opts.dynamicRef)
        gen.var(names_1.default.dynamicAnchors, (0, codegen_1._)`{}`);
    });
  }
  function topSchemaObjCode(it) {
    const { schema, opts, gen } = it;
    validateFunction(it, () => {
      if (opts.$comment && schema.$comment)
        commentKeyword(it);
      checkNoDefault(it);
      gen.let(names_1.default.vErrors, null);
      gen.let(names_1.default.errors, 0);
      if (opts.unevaluated)
        resetEvaluated(it);
      typeAndKeywords(it);
      returnResults(it);
    });
    return;
  }
  function resetEvaluated(it) {
    const { gen, validateName } = it;
    it.evaluated = gen.const("evaluated", (0, codegen_1._)`${validateName}.evaluated`);
    gen.if((0, codegen_1._)`${it.evaluated}.dynamicProps`, () => gen.assign((0, codegen_1._)`${it.evaluated}.props`, (0, codegen_1._)`undefined`));
    gen.if((0, codegen_1._)`${it.evaluated}.dynamicItems`, () => gen.assign((0, codegen_1._)`${it.evaluated}.items`, (0, codegen_1._)`undefined`));
  }
  function funcSourceUrl(schema, opts) {
    const schId = typeof schema == "object" && schema[opts.schemaId];
    return schId && (opts.code.source || opts.code.process) ? (0, codegen_1._)`/*# sourceURL=${schId} */` : codegen_1.nil;
  }
  function subschemaCode(it, valid) {
    if (isSchemaObj(it)) {
      checkKeywords(it);
      if (schemaCxtHasRules(it)) {
        subSchemaObjCode(it, valid);
        return;
      }
    }
    (0, boolSchema_1.boolOrEmptySchema)(it, valid);
  }
  function schemaCxtHasRules({ schema, self }) {
    if (typeof schema == "boolean")
      return !schema;
    for (const key in schema)
      if (self.RULES.all[key])
        return true;
    return false;
  }
  function isSchemaObj(it) {
    return typeof it.schema != "boolean";
  }
  function subSchemaObjCode(it, valid) {
    const { schema, gen, opts } = it;
    if (opts.$comment && schema.$comment)
      commentKeyword(it);
    updateContext(it);
    checkAsyncSchema(it);
    const errsCount = gen.const("_errs", names_1.default.errors);
    typeAndKeywords(it, errsCount);
    gen.var(valid, (0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
  }
  function checkKeywords(it) {
    (0, util_1.checkUnknownRules)(it);
    checkRefsAndKeywords(it);
  }
  function typeAndKeywords(it, errsCount) {
    if (it.opts.jtd)
      return schemaKeywords(it, [], false, errsCount);
    const types = (0, dataType_1.getSchemaTypes)(it.schema);
    const checkedTypes = (0, dataType_1.coerceAndCheckDataType)(it, types);
    schemaKeywords(it, types, !checkedTypes, errsCount);
  }
  function checkRefsAndKeywords(it) {
    const { schema, errSchemaPath, opts, self } = it;
    if (schema.$ref && opts.ignoreKeywordsWithRef && (0, util_1.schemaHasRulesButRef)(schema, self.RULES)) {
      self.logger.warn(`$ref: keywords ignored in schema at path "${errSchemaPath}"`);
    }
  }
  function checkNoDefault(it) {
    const { schema, opts } = it;
    if (schema.default !== undefined && opts.useDefaults && opts.strictSchema) {
      (0, util_1.checkStrictMode)(it, "default is ignored in the schema root");
    }
  }
  function updateContext(it) {
    const schId = it.schema[it.opts.schemaId];
    if (schId)
      it.baseId = (0, resolve_1.resolveUrl)(it.opts.uriResolver, it.baseId, schId);
  }
  function checkAsyncSchema(it) {
    if (it.schema.$async && !it.schemaEnv.$async)
      throw new Error("async schema in sync schema");
  }
  function commentKeyword({ gen, schemaEnv, schema, errSchemaPath, opts }) {
    const msg = schema.$comment;
    if (opts.$comment === true) {
      gen.code((0, codegen_1._)`${names_1.default.self}.logger.log(${msg})`);
    } else if (typeof opts.$comment == "function") {
      const schemaPath = (0, codegen_1.str)`${errSchemaPath}/$comment`;
      const rootName = gen.scopeValue("root", { ref: schemaEnv.root });
      gen.code((0, codegen_1._)`${names_1.default.self}.opts.$comment(${msg}, ${schemaPath}, ${rootName}.schema)`);
    }
  }
  function returnResults(it) {
    const { gen, schemaEnv, validateName, ValidationError, opts } = it;
    if (schemaEnv.$async) {
      gen.if((0, codegen_1._)`${names_1.default.errors} === 0`, () => gen.return(names_1.default.data), () => gen.throw((0, codegen_1._)`new ${ValidationError}(${names_1.default.vErrors})`));
    } else {
      gen.assign((0, codegen_1._)`${validateName}.errors`, names_1.default.vErrors);
      if (opts.unevaluated)
        assignEvaluated(it);
      gen.return((0, codegen_1._)`${names_1.default.errors} === 0`);
    }
  }
  function assignEvaluated({ gen, evaluated, props, items }) {
    if (props instanceof codegen_1.Name)
      gen.assign((0, codegen_1._)`${evaluated}.props`, props);
    if (items instanceof codegen_1.Name)
      gen.assign((0, codegen_1._)`${evaluated}.items`, items);
  }
  function schemaKeywords(it, types, typeErrors, errsCount) {
    const { gen, schema, data, allErrors, opts, self } = it;
    const { RULES } = self;
    if (schema.$ref && (opts.ignoreKeywordsWithRef || !(0, util_1.schemaHasRulesButRef)(schema, RULES))) {
      gen.block(() => keywordCode(it, "$ref", RULES.all.$ref.definition));
      return;
    }
    if (!opts.jtd)
      checkStrictTypes(it, types);
    gen.block(() => {
      for (const group of RULES.rules)
        groupKeywords(group);
      groupKeywords(RULES.post);
    });
    function groupKeywords(group) {
      if (!(0, applicability_1.shouldUseGroup)(schema, group))
        return;
      if (group.type) {
        gen.if((0, dataType_2.checkDataType)(group.type, data, opts.strictNumbers));
        iterateKeywords(it, group);
        if (types.length === 1 && types[0] === group.type && typeErrors) {
          gen.else();
          (0, dataType_2.reportTypeError)(it);
        }
        gen.endIf();
      } else {
        iterateKeywords(it, group);
      }
      if (!allErrors)
        gen.if((0, codegen_1._)`${names_1.default.errors} === ${errsCount || 0}`);
    }
  }
  function iterateKeywords(it, group) {
    const { gen, schema, opts: { useDefaults } } = it;
    if (useDefaults)
      (0, defaults_1.assignDefaults)(it, group.type);
    gen.block(() => {
      for (const rule of group.rules) {
        if ((0, applicability_1.shouldUseRule)(schema, rule)) {
          keywordCode(it, rule.keyword, rule.definition, group.type);
        }
      }
    });
  }
  function checkStrictTypes(it, types) {
    if (it.schemaEnv.meta || !it.opts.strictTypes)
      return;
    checkContextTypes(it, types);
    if (!it.opts.allowUnionTypes)
      checkMultipleTypes(it, types);
    checkKeywordTypes(it, it.dataTypes);
  }
  function checkContextTypes(it, types) {
    if (!types.length)
      return;
    if (!it.dataTypes.length) {
      it.dataTypes = types;
      return;
    }
    types.forEach((t) => {
      if (!includesType(it.dataTypes, t)) {
        strictTypesError(it, `type "${t}" not allowed by context "${it.dataTypes.join(",")}"`);
      }
    });
    narrowSchemaTypes(it, types);
  }
  function checkMultipleTypes(it, ts) {
    if (ts.length > 1 && !(ts.length === 2 && ts.includes("null"))) {
      strictTypesError(it, "use allowUnionTypes to allow union type keyword");
    }
  }
  function checkKeywordTypes(it, ts) {
    const rules = it.self.RULES.all;
    for (const keyword in rules) {
      const rule = rules[keyword];
      if (typeof rule == "object" && (0, applicability_1.shouldUseRule)(it.schema, rule)) {
        const { type } = rule.definition;
        if (type.length && !type.some((t) => hasApplicableType(ts, t))) {
          strictTypesError(it, `missing type "${type.join(",")}" for keyword "${keyword}"`);
        }
      }
    }
  }
  function hasApplicableType(schTs, kwdT) {
    return schTs.includes(kwdT) || kwdT === "number" && schTs.includes("integer");
  }
  function includesType(ts, t) {
    return ts.includes(t) || t === "integer" && ts.includes("number");
  }
  function narrowSchemaTypes(it, withTypes) {
    const ts = [];
    for (const t of it.dataTypes) {
      if (includesType(withTypes, t))
        ts.push(t);
      else if (withTypes.includes("integer") && t === "number")
        ts.push("integer");
    }
    it.dataTypes = ts;
  }
  function strictTypesError(it, msg) {
    const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
    msg += ` at "${schemaPath}" (strictTypes)`;
    (0, util_1.checkStrictMode)(it, msg, it.opts.strictTypes);
  }

  class KeywordCxt {
    constructor(it, def, keyword) {
      (0, keyword_1.validateKeywordUsage)(it, def, keyword);
      this.gen = it.gen;
      this.allErrors = it.allErrors;
      this.keyword = keyword;
      this.data = it.data;
      this.schema = it.schema[keyword];
      this.$data = def.$data && it.opts.$data && this.schema && this.schema.$data;
      this.schemaValue = (0, util_1.schemaRefOrVal)(it, this.schema, keyword, this.$data);
      this.schemaType = def.schemaType;
      this.parentSchema = it.schema;
      this.params = {};
      this.it = it;
      this.def = def;
      if (this.$data) {
        this.schemaCode = it.gen.const("vSchema", getData(this.$data, it));
      } else {
        this.schemaCode = this.schemaValue;
        if (!(0, keyword_1.validSchemaType)(this.schema, def.schemaType, def.allowUndefined)) {
          throw new Error(`${keyword} value must be ${JSON.stringify(def.schemaType)}`);
        }
      }
      if ("code" in def ? def.trackErrors : def.errors !== false) {
        this.errsCount = it.gen.const("_errs", names_1.default.errors);
      }
    }
    result(condition, successAction, failAction) {
      this.failResult((0, codegen_1.not)(condition), successAction, failAction);
    }
    failResult(condition, successAction, failAction) {
      this.gen.if(condition);
      if (failAction)
        failAction();
      else
        this.error();
      if (successAction) {
        this.gen.else();
        successAction();
        if (this.allErrors)
          this.gen.endIf();
      } else {
        if (this.allErrors)
          this.gen.endIf();
        else
          this.gen.else();
      }
    }
    pass(condition, failAction) {
      this.failResult((0, codegen_1.not)(condition), undefined, failAction);
    }
    fail(condition) {
      if (condition === undefined) {
        this.error();
        if (!this.allErrors)
          this.gen.if(false);
        return;
      }
      this.gen.if(condition);
      this.error();
      if (this.allErrors)
        this.gen.endIf();
      else
        this.gen.else();
    }
    fail$data(condition) {
      if (!this.$data)
        return this.fail(condition);
      const { schemaCode } = this;
      this.fail((0, codegen_1._)`${schemaCode} !== undefined && (${(0, codegen_1.or)(this.invalid$data(), condition)})`);
    }
    error(append, errorParams, errorPaths) {
      if (errorParams) {
        this.setParams(errorParams);
        this._error(append, errorPaths);
        this.setParams({});
        return;
      }
      this._error(append, errorPaths);
    }
    _error(append, errorPaths) {
      (append ? errors_1.reportExtraError : errors_1.reportError)(this, this.def.error, errorPaths);
    }
    $dataError() {
      (0, errors_1.reportError)(this, this.def.$dataError || errors_1.keyword$DataError);
    }
    reset() {
      if (this.errsCount === undefined)
        throw new Error('add "trackErrors" to keyword definition');
      (0, errors_1.resetErrorsCount)(this.gen, this.errsCount);
    }
    ok(cond) {
      if (!this.allErrors)
        this.gen.if(cond);
    }
    setParams(obj, assign) {
      if (assign)
        Object.assign(this.params, obj);
      else
        this.params = obj;
    }
    block$data(valid, codeBlock, $dataValid = codegen_1.nil) {
      this.gen.block(() => {
        this.check$data(valid, $dataValid);
        codeBlock();
      });
    }
    check$data(valid = codegen_1.nil, $dataValid = codegen_1.nil) {
      if (!this.$data)
        return;
      const { gen, schemaCode, schemaType, def } = this;
      gen.if((0, codegen_1.or)((0, codegen_1._)`${schemaCode} === undefined`, $dataValid));
      if (valid !== codegen_1.nil)
        gen.assign(valid, true);
      if (schemaType.length || def.validateSchema) {
        gen.elseIf(this.invalid$data());
        this.$dataError();
        if (valid !== codegen_1.nil)
          gen.assign(valid, false);
      }
      gen.else();
    }
    invalid$data() {
      const { gen, schemaCode, schemaType, def, it } = this;
      return (0, codegen_1.or)(wrong$DataType(), invalid$DataSchema());
      function wrong$DataType() {
        if (schemaType.length) {
          if (!(schemaCode instanceof codegen_1.Name))
            throw new Error("ajv implementation error");
          const st = Array.isArray(schemaType) ? schemaType : [schemaType];
          return (0, codegen_1._)`${(0, dataType_2.checkDataTypes)(st, schemaCode, it.opts.strictNumbers, dataType_2.DataType.Wrong)}`;
        }
        return codegen_1.nil;
      }
      function invalid$DataSchema() {
        if (def.validateSchema) {
          const validateSchemaRef = gen.scopeValue("validate$data", { ref: def.validateSchema });
          return (0, codegen_1._)`!${validateSchemaRef}(${schemaCode})`;
        }
        return codegen_1.nil;
      }
    }
    subschema(appl, valid) {
      const subschema = (0, subschema_1.getSubschema)(this.it, appl);
      (0, subschema_1.extendSubschemaData)(subschema, this.it, appl);
      (0, subschema_1.extendSubschemaMode)(subschema, appl);
      const nextContext = { ...this.it, ...subschema, items: undefined, props: undefined };
      subschemaCode(nextContext, valid);
      return nextContext;
    }
    mergeEvaluated(schemaCxt, toName) {
      const { it, gen } = this;
      if (!it.opts.unevaluated)
        return;
      if (it.props !== true && schemaCxt.props !== undefined) {
        it.props = util_1.mergeEvaluated.props(gen, schemaCxt.props, it.props, toName);
      }
      if (it.items !== true && schemaCxt.items !== undefined) {
        it.items = util_1.mergeEvaluated.items(gen, schemaCxt.items, it.items, toName);
      }
    }
    mergeValidEvaluated(schemaCxt, valid) {
      const { it, gen } = this;
      if (it.opts.unevaluated && (it.props !== true || it.items !== true)) {
        gen.if(valid, () => this.mergeEvaluated(schemaCxt, codegen_1.Name));
        return true;
      }
    }
  }
  exports.KeywordCxt = KeywordCxt;
  function keywordCode(it, keyword, def, ruleType) {
    const cxt = new KeywordCxt(it, def, keyword);
    if ("code" in def) {
      def.code(cxt, ruleType);
    } else if (cxt.$data && def.validate) {
      (0, keyword_1.funcKeywordCode)(cxt, def);
    } else if ("macro" in def) {
      (0, keyword_1.macroKeywordCode)(cxt, def);
    } else if (def.compile || def.validate) {
      (0, keyword_1.funcKeywordCode)(cxt, def);
    }
  }
  var JSON_POINTER = /^\/(?:[^~]|~0|~1)*$/;
  var RELATIVE_JSON_POINTER = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
  function getData($data, { dataLevel, dataNames, dataPathArr }) {
    let jsonPointer;
    let data;
    if ($data === "")
      return names_1.default.rootData;
    if ($data[0] === "/") {
      if (!JSON_POINTER.test($data))
        throw new Error(`Invalid JSON-pointer: ${$data}`);
      jsonPointer = $data;
      data = names_1.default.rootData;
    } else {
      const matches = RELATIVE_JSON_POINTER.exec($data);
      if (!matches)
        throw new Error(`Invalid JSON-pointer: ${$data}`);
      const up = +matches[1];
      jsonPointer = matches[2];
      if (jsonPointer === "#") {
        if (up >= dataLevel)
          throw new Error(errorMsg("property/index", up));
        return dataPathArr[dataLevel - up];
      }
      if (up > dataLevel)
        throw new Error(errorMsg("data", up));
      data = dataNames[dataLevel - up];
      if (!jsonPointer)
        return data;
    }
    let expr = data;
    const segments = jsonPointer.split("/");
    for (const segment of segments) {
      if (segment) {
        data = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)((0, util_1.unescapeJsonPointer)(segment))}`;
        expr = (0, codegen_1._)`${expr} && ${data}`;
      }
    }
    return expr;
    function errorMsg(pointerType, up) {
      return `Cannot access ${pointerType} ${up} levels up, current level is ${dataLevel}`;
    }
  }
  exports.getData = getData;
});

// ../../node_modules/ajv/dist/runtime/validation_error.js
var require_validation_error = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });

  class ValidationError extends Error {
    constructor(errors) {
      super("validation failed");
      this.errors = errors;
      this.ajv = this.validation = true;
    }
  }
  exports.default = ValidationError;
});

// ../../node_modules/ajv/dist/compile/ref_error.js
var require_ref_error = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var resolve_1 = require_resolve();

  class MissingRefError extends Error {
    constructor(resolver, baseId, ref, msg) {
      super(msg || `can't resolve reference ${ref} from id ${baseId}`);
      this.missingRef = (0, resolve_1.resolveUrl)(resolver, baseId, ref);
      this.missingSchema = (0, resolve_1.normalizeId)((0, resolve_1.getFullPath)(resolver, this.missingRef));
    }
  }
  exports.default = MissingRefError;
});

// ../../node_modules/ajv/dist/compile/index.js
var require_compile = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.resolveSchema = exports.getCompilingSchema = exports.resolveRef = exports.compileSchema = exports.SchemaEnv = undefined;
  var codegen_1 = require_codegen();
  var validation_error_1 = require_validation_error();
  var names_1 = require_names();
  var resolve_1 = require_resolve();
  var util_1 = require_util();
  var validate_1 = require_validate();

  class SchemaEnv {
    constructor(env) {
      var _a;
      this.refs = {};
      this.dynamicAnchors = {};
      let schema;
      if (typeof env.schema == "object")
        schema = env.schema;
      this.schema = env.schema;
      this.schemaId = env.schemaId;
      this.root = env.root || this;
      this.baseId = (_a = env.baseId) !== null && _a !== undefined ? _a : (0, resolve_1.normalizeId)(schema === null || schema === undefined ? undefined : schema[env.schemaId || "$id"]);
      this.schemaPath = env.schemaPath;
      this.localRefs = env.localRefs;
      this.meta = env.meta;
      this.$async = schema === null || schema === undefined ? undefined : schema.$async;
      this.refs = {};
    }
  }
  exports.SchemaEnv = SchemaEnv;
  function compileSchema(sch) {
    const _sch = getCompilingSchema.call(this, sch);
    if (_sch)
      return _sch;
    const rootId = (0, resolve_1.getFullPath)(this.opts.uriResolver, sch.root.baseId);
    const { es5, lines } = this.opts.code;
    const { ownProperties } = this.opts;
    const gen = new codegen_1.CodeGen(this.scope, { es5, lines, ownProperties });
    let _ValidationError;
    if (sch.$async) {
      _ValidationError = gen.scopeValue("Error", {
        ref: validation_error_1.default,
        code: (0, codegen_1._)`require("ajv/dist/runtime/validation_error").default`
      });
    }
    const validateName = gen.scopeName("validate");
    sch.validateName = validateName;
    const schemaCxt = {
      gen,
      allErrors: this.opts.allErrors,
      data: names_1.default.data,
      parentData: names_1.default.parentData,
      parentDataProperty: names_1.default.parentDataProperty,
      dataNames: [names_1.default.data],
      dataPathArr: [codegen_1.nil],
      dataLevel: 0,
      dataTypes: [],
      definedProperties: new Set,
      topSchemaRef: gen.scopeValue("schema", this.opts.code.source === true ? { ref: sch.schema, code: (0, codegen_1.stringify)(sch.schema) } : { ref: sch.schema }),
      validateName,
      ValidationError: _ValidationError,
      schema: sch.schema,
      schemaEnv: sch,
      rootId,
      baseId: sch.baseId || rootId,
      schemaPath: codegen_1.nil,
      errSchemaPath: sch.schemaPath || (this.opts.jtd ? "" : "#"),
      errorPath: (0, codegen_1._)`""`,
      opts: this.opts,
      self: this
    };
    let sourceCode;
    try {
      this._compilations.add(sch);
      (0, validate_1.validateFunctionCode)(schemaCxt);
      gen.optimize(this.opts.code.optimize);
      const validateCode = gen.toString();
      sourceCode = `${gen.scopeRefs(names_1.default.scope)}return ${validateCode}`;
      if (this.opts.code.process)
        sourceCode = this.opts.code.process(sourceCode, sch);
      const makeValidate = new Function(`${names_1.default.self}`, `${names_1.default.scope}`, sourceCode);
      const validate = makeValidate(this, this.scope.get());
      this.scope.value(validateName, { ref: validate });
      validate.errors = null;
      validate.schema = sch.schema;
      validate.schemaEnv = sch;
      if (sch.$async)
        validate.$async = true;
      if (this.opts.code.source === true) {
        validate.source = { validateName, validateCode, scopeValues: gen._values };
      }
      if (this.opts.unevaluated) {
        const { props, items } = schemaCxt;
        validate.evaluated = {
          props: props instanceof codegen_1.Name ? undefined : props,
          items: items instanceof codegen_1.Name ? undefined : items,
          dynamicProps: props instanceof codegen_1.Name,
          dynamicItems: items instanceof codegen_1.Name
        };
        if (validate.source)
          validate.source.evaluated = (0, codegen_1.stringify)(validate.evaluated);
      }
      sch.validate = validate;
      return sch;
    } catch (e) {
      delete sch.validate;
      delete sch.validateName;
      if (sourceCode)
        this.logger.error("Error compiling schema, function code:", sourceCode);
      throw e;
    } finally {
      this._compilations.delete(sch);
    }
  }
  exports.compileSchema = compileSchema;
  function resolveRef(root, baseId, ref) {
    var _a;
    ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, ref);
    const schOrFunc = root.refs[ref];
    if (schOrFunc)
      return schOrFunc;
    let _sch = resolve.call(this, root, ref);
    if (_sch === undefined) {
      const schema = (_a = root.localRefs) === null || _a === undefined ? undefined : _a[ref];
      const { schemaId } = this.opts;
      if (schema)
        _sch = new SchemaEnv({ schema, schemaId, root, baseId });
    }
    if (_sch === undefined)
      return;
    return root.refs[ref] = inlineOrCompile.call(this, _sch);
  }
  exports.resolveRef = resolveRef;
  function inlineOrCompile(sch) {
    if ((0, resolve_1.inlineRef)(sch.schema, this.opts.inlineRefs))
      return sch.schema;
    return sch.validate ? sch : compileSchema.call(this, sch);
  }
  function getCompilingSchema(schEnv) {
    for (const sch of this._compilations) {
      if (sameSchemaEnv(sch, schEnv))
        return sch;
    }
  }
  exports.getCompilingSchema = getCompilingSchema;
  function sameSchemaEnv(s1, s2) {
    return s1.schema === s2.schema && s1.root === s2.root && s1.baseId === s2.baseId;
  }
  function resolve(root, ref) {
    let sch;
    while (typeof (sch = this.refs[ref]) == "string")
      ref = sch;
    return sch || this.schemas[ref] || resolveSchema.call(this, root, ref);
  }
  function resolveSchema(root, ref) {
    const p = this.opts.uriResolver.parse(ref);
    const refPath = (0, resolve_1._getFullPath)(this.opts.uriResolver, p);
    let baseId = (0, resolve_1.getFullPath)(this.opts.uriResolver, root.baseId, undefined);
    if (Object.keys(root.schema).length > 0 && refPath === baseId) {
      return getJsonPointer.call(this, p, root);
    }
    const id = (0, resolve_1.normalizeId)(refPath);
    const schOrRef = this.refs[id] || this.schemas[id];
    if (typeof schOrRef == "string") {
      const sch = resolveSchema.call(this, root, schOrRef);
      if (typeof (sch === null || sch === undefined ? undefined : sch.schema) !== "object")
        return;
      return getJsonPointer.call(this, p, sch);
    }
    if (typeof (schOrRef === null || schOrRef === undefined ? undefined : schOrRef.schema) !== "object")
      return;
    if (!schOrRef.validate)
      compileSchema.call(this, schOrRef);
    if (id === (0, resolve_1.normalizeId)(ref)) {
      const { schema } = schOrRef;
      const { schemaId } = this.opts;
      const schId = schema[schemaId];
      if (schId)
        baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
      return new SchemaEnv({ schema, schemaId, root, baseId });
    }
    return getJsonPointer.call(this, p, schOrRef);
  }
  exports.resolveSchema = resolveSchema;
  var PREVENT_SCOPE_CHANGE = new Set([
    "properties",
    "patternProperties",
    "enum",
    "dependencies",
    "definitions"
  ]);
  function getJsonPointer(parsedRef, { baseId, schema, root }) {
    var _a;
    if (((_a = parsedRef.fragment) === null || _a === undefined ? undefined : _a[0]) !== "/")
      return;
    for (const part of parsedRef.fragment.slice(1).split("/")) {
      if (typeof schema === "boolean")
        return;
      const partSchema = schema[(0, util_1.unescapeFragment)(part)];
      if (partSchema === undefined)
        return;
      schema = partSchema;
      const schId = typeof schema === "object" && schema[this.opts.schemaId];
      if (!PREVENT_SCOPE_CHANGE.has(part) && schId) {
        baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
      }
    }
    let env;
    if (typeof schema != "boolean" && schema.$ref && !(0, util_1.schemaHasRulesButRef)(schema, this.RULES)) {
      const $ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schema.$ref);
      env = resolveSchema.call(this, root, $ref);
    }
    const { schemaId } = this.opts;
    env = env || new SchemaEnv({ schema, schemaId, root, baseId });
    if (env.schema !== env.root.schema)
      return env;
    return;
  }
});

// ../../node_modules/ajv/dist/refs/data.json
var require_data = __commonJS(function(exports, module) {
  module.exports = {
    $id: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#",
    description: "Meta-schema for $data reference (JSON AnySchema extension proposal)",
    type: "object",
    required: ["$data"],
    properties: {
      $data: {
        type: "string",
        anyOf: [{ format: "relative-json-pointer" }, { format: "json-pointer" }]
      }
    },
    additionalProperties: false
  };
});

// ../../node_modules/fast-uri/lib/utils.js
var require_utils = __commonJS(function(exports, module) {
  var isUUID = RegExp.prototype.test.bind(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu);
  var isIPv4 = RegExp.prototype.test.bind(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u);
  var isPort = RegExp.prototype.test.bind(/^\d*$/u);
  var isHexPair = RegExp.prototype.test.bind(/^[\da-f]{2}$/iu);
  var isUnreserved = RegExp.prototype.test.bind(/^[\da-z\-._~]$/iu);
  var isPathCharacter = RegExp.prototype.test.bind(/^[A-Za-z0-9\-._~!$&'()*+,;=:@/]$/u);
  var isQueryFragmentCharacter = RegExp.prototype.test.bind(/^[A-Za-z0-9\-._~!$&'()*+,;=:@/?]$/u);
  var isUserinfoCharacter = RegExp.prototype.test.bind(/^[A-Za-z0-9\-._~!$&'()*+,;=:]$/u);
  var BYTE_HEX = new Array(256);
  {
    const HEX_DIGITS = "0123456789ABCDEF";
    for (let i = 0;i < 256; i++) {
      BYTE_HEX[i] = "%" + HEX_DIGITS[i >> 4] + HEX_DIGITS[i & 15];
    }
  }
  function percentEncodeNonAscii(cp) {
    if (cp < 2048) {
      return BYTE_HEX[192 | cp >> 6] + BYTE_HEX[128 | cp & 63];
    }
    if (cp < 65536) {
      return BYTE_HEX[224 | cp >> 12] + BYTE_HEX[128 | cp >> 6 & 63] + BYTE_HEX[128 | cp & 63];
    }
    return BYTE_HEX[240 | cp >> 18] + BYTE_HEX[128 | cp >> 12 & 63] + BYTE_HEX[128 | cp >> 6 & 63] + BYTE_HEX[128 | cp & 63];
  }
  function stringArrayToHexStripped(input) {
    let acc = "";
    let code = 0;
    let i = 0;
    for (i = 0;i < input.length; i++) {
      code = input[i].charCodeAt(0);
      if (code === 48) {
        continue;
      }
      if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) {
        return "";
      }
      acc += input[i];
      break;
    }
    for (i += 1;i < input.length; i++) {
      code = input[i].charCodeAt(0);
      if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) {
        return "";
      }
      acc += input[i];
    }
    return acc;
  }
  var isHextet = RegExp.prototype.test.bind(/^[\dA-Fa-f]{1,4}$/);
  var isIPvFuture = RegExp.prototype.test.bind(/^[vV][\dA-Fa-f]+\.[A-Za-z\d\-._~!$&'()*+,;=:]+$/);
  var isZoneCharacter = RegExp.prototype.test.bind(/^[A-Za-z\d\-._~]$/);
  var nonSimpleDomain = RegExp.prototype.test.bind(/[^!"$&'()*+,\-.;=_`a-z{}~]/u);
  function isZoneIdentifier(zone) {
    if (zone.length === 0)
      return false;
    for (let i = 0;i < zone.length; i++) {
      if (isZoneCharacter(zone[i]))
        continue;
      if (zone[i] === "%" && i + 2 < zone.length && isHexPair(zone.slice(i + 1, i + 3))) {
        i += 2;
        continue;
      }
      return false;
    }
    return true;
  }
  function compressIPv6ZeroRun(hextets) {
    let bestStart = -1;
    let bestLength = 0;
    let runStart = -1;
    let runLength = 0;
    for (let i = 0;i < hextets.length; i++) {
      if (hextets[i] === "0") {
        if (runStart === -1)
          runStart = i;
        runLength++;
        if (runLength > bestLength) {
          bestLength = runLength;
          bestStart = runStart;
        }
      } else {
        runStart = -1;
        runLength = 0;
      }
    }
    if (bestLength < 2)
      return hextets.join(":");
    const head = hextets.slice(0, bestStart).join(":");
    const tail = hextets.slice(bestStart + bestLength).join(":");
    return head + "::" + tail;
  }
  function normalizeIPv6Address(input) {
    const compression = input.indexOf("::");
    if (compression !== -1 && input.indexOf("::", compression + 1) !== -1)
      return;
    const left = compression === -1 ? input.split(":") : input.slice(0, compression).split(":");
    const right = compression === -1 ? [] : input.slice(compression + 2).split(":");
    if (compression !== -1) {
      if (left.length === 1 && left[0] === "")
        left.length = 0;
      if (right.length === 1 && right[0] === "")
        right.length = 0;
    }
    const parts = left.concat(right);
    let hextetCount = 0;
    for (let i = 0;i < parts.length; i++) {
      const part = parts[i];
      if (part === "")
        return;
      if (part.indexOf(".") !== -1) {
        if (i !== parts.length - 1 || compression !== -1 && right.length === 0 || !isIPv4(part))
          return;
        hextetCount += 2;
        continue;
      }
      if (!isHextet(part))
        return;
      parts[i] = parseInt(part, 16).toString(16);
      hextetCount++;
    }
    if (compression === -1) {
      if (hextetCount !== 8)
        return;
      return compressIPv6ZeroRun(parts);
    }
    if (hextetCount >= 8)
      return;
    const expanded = parts.slice(0, left.length);
    for (let i = hextetCount;i < 8; i++)
      expanded.push("0");
    for (let i = left.length;i < parts.length; i++)
      expanded.push(parts[i]);
    return compressIPv6ZeroRun(expanded);
  }
  function normalizeIPv6(host) {
    const bracketed = host[0] === "[" && host[host.length - 1] === "]";
    const hasBracket = host[0] === "[" || host[host.length - 1] === "]";
    if (hasBracket && !bracketed)
      return { host, isIPV6: false, error: true };
    let input = bracketed ? host.slice(1, -1) : host;
    if (bracketed && isIPvFuture(input)) {
      input = input.toLowerCase();
      return { host: `[${input}]`, escapedHost: input, isIPV6: false, isIPVFuture: true };
    }
    if (findToken(input, ":") < 2) {
      return { host, isIPV6: false, error: bracketed };
    }
    let zoneIdentifier = "";
    const zoneSeparator = input.indexOf("%");
    if (zoneSeparator !== -1) {
      const separatorLength = input.slice(zoneSeparator, zoneSeparator + 3).toLowerCase() === "%25" ? 3 : 1;
      zoneIdentifier = input.slice(zoneSeparator + separatorLength);
      if (!isZoneIdentifier(zoneIdentifier))
        return { host, isIPV6: false, error: true };
      input = input.slice(0, zoneSeparator);
    }
    const address = normalizeIPv6Address(input);
    if (address === undefined)
      return { host, isIPV6: false, error: true };
    return {
      host: address + (zoneIdentifier ? "%" + zoneIdentifier : ""),
      escapedHost: address + (zoneIdentifier ? "%25" + zoneIdentifier : ""),
      isIPV6: true
    };
  }
  function findToken(str, token) {
    let ind = 0;
    for (let i = 0;i < str.length; i++) {
      if (str[i] === token)
        ind++;
    }
    return ind;
  }
  function removeDotSegments(path) {
    let input = path;
    const output = [];
    let nextSlash = -1;
    let len = 0;
    while (len = input.length) {
      if (len === 1) {
        if (input === ".") {
          break;
        } else if (input === "/") {
          output.push("/");
          break;
        } else {
          output.push(input);
          break;
        }
      } else if (len === 2) {
        if (input[0] === ".") {
          if (input[1] === ".") {
            break;
          } else if (input[1] === "/") {
            input = input.slice(2);
            continue;
          }
        } else if (input[0] === "/") {
          if (input[1] === "." || input[1] === "/") {
            output.push("/");
            break;
          }
        }
      } else if (len === 3) {
        if (input === "/..") {
          if (output.length !== 0) {
            output.pop();
          }
          output.push("/");
          break;
        }
      }
      if (input[0] === ".") {
        if (input[1] === ".") {
          if (input[2] === "/") {
            input = input.slice(3);
            continue;
          }
        } else if (input[1] === "/") {
          input = input.slice(2);
          continue;
        }
      } else if (input[0] === "/") {
        if (input[1] === ".") {
          if (input[2] === "/") {
            input = input.slice(2);
            continue;
          } else if (input[2] === ".") {
            if (input[3] === "/") {
              input = input.slice(3);
              if (output.length !== 0) {
                output.pop();
              }
              continue;
            }
          }
        }
      }
      if ((nextSlash = input.indexOf("/", 1)) === -1) {
        output.push(input);
        break;
      } else {
        output.push(input.slice(0, nextSlash));
        input = input.slice(nextSlash);
      }
    }
    return output.join("");
  }
  function removeDotSegmentsRelative(path) {
    if (path === "" || path[0] === "/") {
      return removeDotSegments(path);
    }
    const segments = path.split("/");
    const last = segments.length - 1;
    const output = [];
    let trailingDirectory = false;
    for (let i = 0;i <= last; i++) {
      const segment = segments[i];
      if (segment === "." || segment === "..") {
        if (segment === "..") {
          if (output.length !== 0 && output[output.length - 1] !== "..") {
            output.pop();
          } else {
            output.push("..");
          }
        }
        trailingDirectory = i === last;
      } else {
        output.push(segment);
      }
    }
    if (trailingDirectory && output[output.length - 1] !== "..") {
      output.push("");
    }
    if (output.length === 0 || output[0] === "" || output[0].includes(":")) {
      output.unshift(".");
    }
    return output.join("/");
  }
  var HOST_DELIMS = { "@": "%40", "/": "%2F", "?": "%3F", "#": "%23", ":": "%3A" };
  var HOST_DELIM_RE = /[@/?#:]/g;
  var HOST_DELIM_NO_COLON_RE = /[@/?#]/g;
  function reescapeHostDelimiters(host, isIP) {
    const re = isIP ? HOST_DELIM_NO_COLON_RE : HOST_DELIM_RE;
    re.lastIndex = 0;
    return host.replace(re, (ch) => HOST_DELIMS[ch]);
  }
  function normalizePercentEncoding(input, decodeUnreserved = false) {
    if (input.indexOf("%") === -1) {
      return input;
    }
    let output = "";
    for (let i = 0;i < input.length; i++) {
      if (input[i] === "%" && i + 2 < input.length) {
        const hex = input.slice(i + 1, i + 3);
        if (isHexPair(hex)) {
          const normalizedHex = hex.toUpperCase();
          const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
          if (decodeUnreserved && isUnreserved(decoded)) {
            output += decoded;
          } else {
            output += "%" + normalizedHex;
          }
          i += 2;
          continue;
        }
      }
      output += input[i];
    }
    return output;
  }
  function normalizePathEncoding(input) {
    let output = "";
    for (let i = 0;i < input.length; i++) {
      const ch = input[i];
      if (ch === "%" && i + 2 < input.length) {
        const hex = input.slice(i + 1, i + 3);
        if (isHexPair(hex)) {
          const normalizedHex = hex.toUpperCase();
          const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
          if (decoded !== "." && isUnreserved(decoded)) {
            output += decoded;
          } else {
            output += "%" + normalizedHex;
          }
          i += 2;
          continue;
        }
      }
      if (isPathCharacter(ch)) {
        output += ch;
      } else {
        const code = input.charCodeAt(i);
        if (code < 128) {
          output += isEscapeSafe(code) ? ch : BYTE_HEX[code];
        } else if (code < 55296 || code > 57343) {
          output += percentEncodeNonAscii(code);
        } else if (code <= 56319 && i + 1 < input.length) {
          const low = input.charCodeAt(i + 1);
          if (low >= 56320 && low <= 57343) {
            output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320));
            i++;
          } else {
            output += percentEncodeNonAscii(65533);
          }
        } else {
          output += percentEncodeNonAscii(65533);
        }
      }
    }
    return output;
  }
  function serializePathEncoding(input, pathNoScheme = false) {
    let output = "";
    let firstSegment = pathNoScheme && input[0] !== "/";
    for (let i = 0;i < input.length; i++) {
      const ch = input[i];
      if (ch === "%" && i + 2 < input.length) {
        const hex = input.slice(i + 1, i + 3);
        if (isHexPair(hex)) {
          output += "%" + hex.toUpperCase();
          i += 2;
          continue;
        }
      }
      if (ch === "/") {
        firstSegment = false;
      }
      if (isPathCharacter(ch) && (ch !== ":" || !firstSegment)) {
        output += ch;
      } else {
        const code = input.charCodeAt(i);
        if (code < 128) {
          output += BYTE_HEX[code];
        } else if (code < 55296 || code > 57343) {
          output += percentEncodeNonAscii(code);
        } else if (code <= 56319 && i + 1 < input.length) {
          const low = input.charCodeAt(i + 1);
          if (low >= 56320 && low <= 57343) {
            output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320));
            i++;
          } else {
            output += percentEncodeNonAscii(65533);
          }
        } else {
          output += percentEncodeNonAscii(65533);
        }
      }
    }
    return output;
  }
  function encodeComponent(input, isAllowed) {
    let output = "";
    for (let i = 0;i < input.length; i++) {
      const ch = input[i];
      if (ch === "%" && i + 2 < input.length) {
        const hex = input.slice(i + 1, i + 3);
        if (isHexPair(hex)) {
          output += "%" + hex.toUpperCase();
          i += 2;
          continue;
        }
      }
      if (isAllowed(ch)) {
        output += ch;
      } else {
        const code = input.charCodeAt(i);
        if (code < 128) {
          output += BYTE_HEX[code];
        } else if (code < 55296 || code > 57343) {
          output += percentEncodeNonAscii(code);
        } else if (code <= 56319 && i + 1 < input.length) {
          const low = input.charCodeAt(i + 1);
          if (low >= 56320 && low <= 57343) {
            output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320));
            i++;
          } else {
            output += percentEncodeNonAscii(65533);
          }
        } else {
          output += percentEncodeNonAscii(65533);
        }
      }
    }
    return output;
  }
  function encodeUserinfo(input) {
    return encodeComponent(input, isUserinfoCharacter);
  }
  function encodeQuery(input) {
    return encodeComponent(input, isQueryFragmentCharacter);
  }
  function encodeFragment(input) {
    return encodeComponent(input, isQueryFragmentCharacter);
  }
  function isEscapeSafe(cp) {
    return cp >= 48 && cp <= 57 || cp >= 65 && cp <= 90 || cp >= 97 && cp <= 122 || cp === 42 || cp === 43 || cp === 45 || cp === 46 || cp === 47 || cp === 64 || cp === 95;
  }
  function normalizeQueryFragmentEncoding(input) {
    let output = "";
    for (let i = 0;i < input.length; i++) {
      const ch = input[i];
      if (ch === "%" && i + 2 < input.length) {
        const hex = input.slice(i + 1, i + 3);
        if (isHexPair(hex)) {
          const normalizedHex = hex.toUpperCase();
          const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
          if (isUnreserved(decoded)) {
            output += decoded;
          } else {
            output += "%" + normalizedHex;
          }
          i += 2;
          continue;
        }
      }
      if (isQueryFragmentCharacter(ch)) {
        output += ch;
      } else {
        const code = input.charCodeAt(i);
        if (code < 128) {
          output += isEscapeSafe(code) ? ch : BYTE_HEX[code];
        } else if (code < 55296 || code > 57343) {
          output += percentEncodeNonAscii(code);
        } else if (code <= 56319 && i + 1 < input.length) {
          const low = input.charCodeAt(i + 1);
          if (low >= 56320 && low <= 57343) {
            output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320));
            i++;
          } else {
            output += percentEncodeNonAscii(65533);
          }
        } else {
          output += percentEncodeNonAscii(65533);
        }
      }
    }
    return output;
  }
  function escapePreservingEscapes(input) {
    let output = "";
    for (let i = 0;i < input.length; i++) {
      if (input[i] === "%" && i + 2 < input.length) {
        const hex = input.slice(i + 1, i + 3);
        if (isHexPair(hex)) {
          output += "%" + hex.toUpperCase();
          i += 2;
          continue;
        }
      }
      output += escape(input[i]);
    }
    return output;
  }
  function recomposeAuthority(component) {
    const uriTokens = [];
    if (component.userinfo !== undefined) {
      uriTokens.push(encodeUserinfo(component.userinfo));
      uriTokens.push("@");
    }
    if (component.host !== undefined) {
      let host = component.host;
      if (!isIPv4(host)) {
        let ipV6res = normalizeIPv6(host);
        if (ipV6res.isIPV6 !== true && ipV6res.isIPVFuture !== true) {
          host = normalizePercentEncoding(host, true);
          ipV6res = normalizeIPv6(host);
        }
        if (ipV6res.isIPV6 === true || ipV6res.isIPVFuture === true) {
          host = `[${ipV6res.escapedHost}]`;
        } else {
          host = reescapeHostDelimiters(host, false);
        }
      }
      uriTokens.push(host);
    }
    if (typeof component.port === "number" || typeof component.port === "string") {
      const port = String(component.port);
      if (!isPort(port)) {
        throw new TypeError("URI port is malformed.");
      }
      uriTokens.push(":");
      uriTokens.push(port);
    }
    return uriTokens.length ? uriTokens.join("") : undefined;
  }
  module.exports = {
    nonSimpleDomain,
    recomposeAuthority,
    reescapeHostDelimiters,
    normalizePercentEncoding,
    normalizePathEncoding,
    serializePathEncoding,
    normalizeQueryFragmentEncoding,
    encodeUserinfo,
    encodeQuery,
    encodeFragment,
    escapePreservingEscapes,
    removeDotSegments,
    removeDotSegmentsRelative,
    isIPv4,
    isUUID,
    normalizeIPv6,
    stringArrayToHexStripped
  };
});

// ../../node_modules/fast-uri/lib/schemes.js
var require_schemes = __commonJS(function(exports, module) {
  var { isUUID } = require_utils();
  var URN_REG = /^([\da-z][\d\-a-z]{0,31}):((?:[\w!$'()*+,\-./:;=@]|%[\da-f]{2})+)$/iu;
  var supportedSchemeNames = [
    "http",
    "https",
    "ws",
    "wss",
    "urn",
    "urn:uuid"
  ];
  function isValidSchemeName(name) {
    return supportedSchemeNames.indexOf(name) !== -1;
  }
  function wsIsSecure(wsComponent) {
    if (wsComponent.secure === true) {
      return true;
    } else if (wsComponent.secure === false) {
      return false;
    } else if (wsComponent.scheme) {
      return wsComponent.scheme.length === 3 && (wsComponent.scheme[0] === "w" || wsComponent.scheme[0] === "W") && (wsComponent.scheme[1] === "s" || wsComponent.scheme[1] === "S") && (wsComponent.scheme[2] === "s" || wsComponent.scheme[2] === "S");
    } else {
      return false;
    }
  }
  function httpParse(component) {
    if (!component.host) {
      component.error = component.error || "HTTP URIs must have a host.";
    }
    return component;
  }
  function httpSerialize(component) {
    const secure = String(component.scheme).toLowerCase() === "https";
    if (component.port === (secure ? 443 : 80) || component.port === "") {
      component.port = undefined;
    }
    if (!component.path) {
      component.path = "/";
    }
    return component;
  }
  function wsParse(wsComponent) {
    wsComponent.secure = wsIsSecure(wsComponent);
    wsComponent.resourceName = (wsComponent.path || "/") + (wsComponent.query ? "?" + wsComponent.query : "");
    wsComponent.path = undefined;
    wsComponent.query = undefined;
    return wsComponent;
  }
  function wsSerialize(wsComponent) {
    if (wsComponent.port === (wsIsSecure(wsComponent) ? 443 : 80) || wsComponent.port === "") {
      wsComponent.port = undefined;
    }
    if (typeof wsComponent.secure === "boolean") {
      wsComponent.scheme = wsComponent.secure ? "wss" : "ws";
      wsComponent.secure = undefined;
    }
    if (wsComponent.resourceName) {
      const queryIndex = wsComponent.resourceName.indexOf("?");
      const path = queryIndex === -1 ? wsComponent.resourceName : wsComponent.resourceName.slice(0, queryIndex);
      wsComponent.path = path && path !== "/" ? path : undefined;
      wsComponent.query = queryIndex === -1 ? undefined : wsComponent.resourceName.slice(queryIndex + 1);
      wsComponent.resourceName = undefined;
    }
    wsComponent.fragment = undefined;
    return wsComponent;
  }
  function urnParse(urnComponent, options) {
    if (!urnComponent.path) {
      urnComponent.error = "URN can not be parsed";
      return urnComponent;
    }
    const matches = urnComponent.path.match(URN_REG);
    if (matches && matches[0] === urnComponent.path) {
      const scheme = options.scheme || urnComponent.scheme || "urn";
      urnComponent.nid = matches[1].toLowerCase();
      urnComponent.nss = matches[2];
      const urnScheme = `${scheme}:${options.nid || urnComponent.nid}`;
      const schemeHandler = getSchemeHandler(urnScheme);
      urnComponent.path = undefined;
      if (schemeHandler) {
        urnComponent = schemeHandler.parse(urnComponent, options);
      }
    } else {
      urnComponent.error = urnComponent.error || "URN can not be parsed.";
    }
    return urnComponent;
  }
  function urnSerialize(urnComponent, options) {
    if (urnComponent.nid === undefined) {
      throw new Error("URN without nid cannot be serialized");
    }
    const scheme = options.scheme || urnComponent.scheme || "urn";
    const nid = urnComponent.nid.toLowerCase();
    const urnScheme = `${scheme}:${options.nid || nid}`;
    const schemeHandler = getSchemeHandler(urnScheme);
    if (schemeHandler) {
      urnComponent = schemeHandler.serialize(urnComponent, options);
    }
    const uriComponent = urnComponent;
    const nss = urnComponent.nss;
    uriComponent.path = `${nid || options.nid}:${nss}`;
    options.skipEscape = true;
    return uriComponent;
  }
  function urnuuidParse(urnComponent, options) {
    const uuidComponent = urnComponent;
    uuidComponent.uuid = uuidComponent.nss;
    uuidComponent.nss = undefined;
    if (!options.tolerant && (!uuidComponent.uuid || !isUUID(uuidComponent.uuid))) {
      uuidComponent.error = uuidComponent.error || "UUID is not valid.";
    }
    return uuidComponent;
  }
  function urnuuidSerialize(uuidComponent) {
    const urnComponent = uuidComponent;
    urnComponent.nss = (uuidComponent.uuid || "").toLowerCase();
    return urnComponent;
  }
  var http = {
    scheme: "http",
    domainHost: true,
    parse: httpParse,
    serialize: httpSerialize
  };
  var https = {
    scheme: "https",
    domainHost: http.domainHost,
    parse: httpParse,
    serialize: httpSerialize
  };
  var ws = {
    scheme: "ws",
    domainHost: true,
    parse: wsParse,
    serialize: wsSerialize
  };
  var wss = {
    scheme: "wss",
    domainHost: ws.domainHost,
    parse: ws.parse,
    serialize: ws.serialize
  };
  var urn = {
    scheme: "urn",
    parse: urnParse,
    serialize: urnSerialize,
    skipNormalize: true
  };
  var urnuuid = {
    scheme: "urn:uuid",
    parse: urnuuidParse,
    serialize: urnuuidSerialize,
    skipNormalize: true
  };
  var SCHEMES = {
    http,
    https,
    ws,
    wss,
    urn,
    "urn:uuid": urnuuid
  };
  Object.setPrototypeOf(SCHEMES, null);
  function getSchemeHandler(scheme) {
    return scheme && (SCHEMES[scheme] || SCHEMES[scheme.toLowerCase()]) || undefined;
  }
  module.exports = {
    wsIsSecure,
    SCHEMES,
    isValidSchemeName,
    getSchemeHandler
  };
});

// ../../node_modules/fast-uri/index.js
var require_fast_uri = __commonJS(function(exports, module) {
  var { normalizeIPv6, removeDotSegments, removeDotSegmentsRelative, recomposeAuthority, normalizePercentEncoding, normalizePathEncoding, serializePathEncoding, normalizeQueryFragmentEncoding, encodeQuery, encodeFragment, reescapeHostDelimiters, isIPv4, nonSimpleDomain } = require_utils();
  var { SCHEMES, getSchemeHandler } = require_schemes();
  var VALID_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/u;
  var MALFORMED_SCHEME_ERROR = "URI scheme is malformed.";
  var MALFORMED_HOST_ERROR = "URI host is malformed.";
  var FORBIDDEN_DOMAIN_HOST_CHARACTER = /[\0-\x20"#/:<>?@[\\\]^`{|}\x7F]/u;
  function validateScheme(scheme) {
    const stringScheme = String(scheme);
    if (!VALID_SCHEME.test(stringScheme)) {
      throw new TypeError(MALFORMED_SCHEME_ERROR);
    }
    return stringScheme;
  }
  function normalize(uri, options) {
    if (typeof uri === "string") {
      uri = normalizeString(uri, options);
    } else if (typeof uri === "object") {
      uri = parse(serialize(uri, options), options);
    }
    return uri;
  }
  function resolve(baseURI, relativeURI, options) {
    const schemelessOptions = options ? Object.assign({ scheme: "null" }, options) : { scheme: "null" };
    const {
      parsed: baseParsed,
      malformedAuthorityOrPort: baseMalformed,
      malformedPercentEncoding: baseMalformedPercentEncoding,
      malformedSchemeSpecific: baseMalformedSchemeSpecific,
      malformedHost: baseMalformedHost,
      malformedScheme: baseMalformedScheme
    } = parseWithStatus(baseURI, schemelessOptions);
    const {
      parsed: relativeParsed,
      malformedAuthorityOrPort: relativeMalformed,
      malformedPercentEncoding: relativeMalformedPercentEncoding,
      malformedSchemeSpecific: relativeMalformedSchemeSpecific,
      malformedHost: relativeMalformedHost,
      malformedScheme: relativeMalformedScheme
    } = parseWithStatus(relativeURI, schemelessOptions);
    if (baseMalformed || relativeMalformed || baseMalformedPercentEncoding || relativeMalformedPercentEncoding || baseMalformedSchemeSpecific || relativeMalformedSchemeSpecific || baseMalformedHost || relativeMalformedHost || baseMalformedScheme || relativeMalformedScheme) {
      throw new Error(baseParsed.error || relativeParsed.error || "URI is malformed.");
    }
    const resolved = resolveComponent(baseParsed, relativeParsed, schemelessOptions, true);
    const resolvedSchemeHandler = getSchemeHandler(options && options.scheme || resolved.scheme);
    const resolvedHost = resolved.host;
    const resolvedHostIsIP = resolvedHost !== undefined && resolvedHost !== "" && (isIPv4(resolvedHost) || normalizeIPv6(resolvedHost).isIPV6);
    if (hasForbiddenDomainHost(resolved, options || {}, resolvedSchemeHandler, resolvedHostIsIP)) {
      throw new Error(MALFORMED_HOST_ERROR);
    }
    canonicalizeHost(resolved, options || {}, resolvedSchemeHandler, resolvedHostIsIP);
    const encodedASCIIHost = resolvedHost && resolvedHost.indexOf("%") !== -1 && !/\P{ASCII}/u.test(resolvedHost);
    if (resolved.error && !encodedASCIIHost) {
      throw new Error(resolved.error);
    }
    schemelessOptions.skipEscape = true;
    return serialize(resolved, schemelessOptions);
  }
  function resolveComponent(base, relative, options, skipNormalization) {
    const target = {};
    if (!skipNormalization) {
      base = parse(serialize(base, options), options);
      relative = parse(serialize(relative, options), options);
    }
    options = options || {};
    if (!options.tolerant && relative.scheme) {
      target.scheme = relative.scheme;
      target.userinfo = relative.userinfo;
      target.host = relative.host;
      target.port = relative.port;
      target.path = removeDotSegments(relative.path || "");
      target.query = relative.query;
    } else {
      if (relative.userinfo !== undefined || relative.host !== undefined || relative.port !== undefined) {
        target.userinfo = relative.userinfo;
        target.host = relative.host;
        target.port = relative.port;
        target.path = removeDotSegments(relative.path || "");
        target.query = relative.query;
      } else {
        if (!relative.path) {
          target.path = base.path;
          if (relative.query !== undefined) {
            target.query = relative.query;
          } else {
            target.query = base.query;
          }
        } else {
          if (relative.path[0] === "/") {
            target.path = removeDotSegments(relative.path);
          } else {
            const baseHasAuthority = base.userinfo !== undefined || base.host !== undefined || base.port !== undefined;
            if (baseHasAuthority && !base.path) {
              target.path = "/" + relative.path;
            } else if (!base.path) {
              target.path = relative.path;
            } else {
              target.path = base.path.slice(0, base.path.lastIndexOf("/") + 1) + relative.path;
            }
            target.path = base.scheme === undefined && !baseHasAuthority && target.path[0] !== "/" ? removeDotSegmentsRelative(target.path) : removeDotSegments(target.path);
          }
          target.query = relative.query;
        }
        target.userinfo = base.userinfo;
        target.host = base.host;
        target.port = base.port;
      }
      target.scheme = base.scheme;
    }
    target.fragment = relative.fragment;
    return target;
  }
  function equal(uriA, uriB, options) {
    const normalizedA = normalizeComparableURI(uriA, options);
    const normalizedB = normalizeComparableURI(uriB, options);
    return normalizedA !== undefined && normalizedB !== undefined && normalizedA === normalizedB;
  }
  function serialize(cmpts, opts) {
    const component = {
      host: cmpts.host,
      scheme: cmpts.scheme,
      userinfo: cmpts.userinfo,
      port: cmpts.port,
      path: cmpts.path,
      query: cmpts.query,
      nid: cmpts.nid,
      nss: cmpts.nss,
      uuid: cmpts.uuid,
      fragment: cmpts.fragment,
      reference: cmpts.reference,
      resourceName: cmpts.resourceName,
      secure: cmpts.secure,
      error: ""
    };
    const options = Object.assign({}, opts);
    const uriTokens = [];
    if (component.scheme) {
      component.scheme = validateScheme(component.scheme);
    }
    const schemeHandler = getSchemeHandler(options.scheme || component.scheme);
    if (schemeHandler && schemeHandler.serialize)
      schemeHandler.serialize(component, options);
    const hasAuthority = component.userinfo !== undefined || component.host !== undefined || component.port !== undefined;
    const schemelessReference = (component.scheme === undefined || options.reference === "suffix") && !hasAuthority;
    const pathNoScheme = !options.skipEscape && schemelessReference;
    if (component.path !== undefined) {
      if (!options.skipEscape) {
        component.path = serializePathEncoding(component.path, pathNoScheme);
      } else {
        component.path = normalizePercentEncoding(component.path);
      }
    }
    if (options.reference !== "suffix" && component.scheme) {
      component.scheme = validateScheme(component.scheme);
      uriTokens.push(component.scheme, ":");
    }
    const authority = recomposeAuthority(component);
    if (authority !== undefined) {
      if (options.reference !== "suffix") {
        uriTokens.push("//");
      }
      uriTokens.push(authority);
      if (component.path && component.path[0] !== "/") {
        uriTokens.push("/");
      }
    }
    if (component.path !== undefined) {
      let s = component.path;
      if (!options.absolutePath && (!schemeHandler || !schemeHandler.absolutePath)) {
        s = schemelessReference && s[0] !== "/" ? removeDotSegmentsRelative(s) : removeDotSegments(s);
      }
      if (schemelessReference) {
        s = serializePathEncoding(s, true);
      }
      if (authority === undefined && s[0] === "/" && s[1] === "/") {
        s = "/%2F" + s.slice(2);
      }
      uriTokens.push(s);
    }
    if (component.query !== undefined) {
      uriTokens.push("?", encodeQuery(component.query));
    }
    if (component.fragment !== undefined) {
      uriTokens.push("#", encodeFragment(component.fragment));
    }
    return uriTokens.join("");
  }
  var URI_PARSE = /^(?:([^#/:?]+):)?(?:\/\/((?:([^#/?@]*)@)?(\[[^#/?\]]+\]|[^#/:?]*)(?::(\d*))?))?([^#?]*)(?:\?([^#]*))?(?:#((?:.|[\n\r])*))?/u;
  var AUTHORITY_PREFIX = /^(?:[^#/:?]+:)?\/\/([^/?#]*)/;
  var AUTHORITY_INTRODUCER_REGION = /^(?:[^#/:?]+:)?([/\\\t\n\r]*)/;
  function getParseError(parsed, matches) {
    if (matches[2] !== undefined && parsed.path && parsed.path[0] !== "/") {
      return 'URI path must start with "/" when authority is present.';
    }
    if (typeof parsed.port === "number" && (parsed.port < 0 || parsed.port > 65535)) {
      return "URI port is malformed.";
    }
    return;
  }
  function hasMalformedPercentEncoding(component) {
    if (component === undefined)
      return false;
    let percent = component.indexOf("%");
    while (percent !== -1) {
      if (percent + 2 >= component.length || !/^[\da-f]{2}$/iu.test(component.slice(percent + 1, percent + 3))) {
        return true;
      }
      percent = component.indexOf("%", percent + 3);
    }
    return false;
  }
  function isIPLiteral(host) {
    return host[0] === "[" && host[host.length - 1] === "]";
  }
  function hasMalformedComponentPercentEncoding(matches) {
    const host = matches[4];
    return hasMalformedPercentEncoding(matches[3]) || host !== undefined && !isIPLiteral(host) && hasMalformedPercentEncoding(host) || hasMalformedPercentEncoding(matches[6]) || hasMalformedPercentEncoding(matches[7]) || hasMalformedPercentEncoding(matches[8]);
  }
  function canonicalizeHost(parsed, options, schemeHandler, isIP) {
    if (hasForbiddenDomainHost(parsed, options, schemeHandler, isIP)) {
      parsed.error = parsed.error || MALFORMED_HOST_ERROR;
      return true;
    }
    if (!options.unicodeSupport && (!schemeHandler || !schemeHandler.unicodeSupport) && parsed.host && !isIPLiteral(parsed.host) && (options.domainHost || schemeHandler && schemeHandler.domainHost) && isIP === false && nonSimpleDomain(parsed.host)) {
      let url;
      try {
        url = new URL("http://" + parsed.host);
      } catch (e) {
        parsed.error = parsed.error || "Host's domain name can not be converted to ASCII: " + e;
        return true;
      }
      if (!isHostOnlyURL(url)) {
        parsed.error = parsed.error || MALFORMED_HOST_ERROR;
        return true;
      }
      parsed.host = url.hostname;
    }
    return false;
  }
  function hasForbiddenDomainHost(parsed, options, schemeHandler, isIP) {
    return Boolean(parsed.host && isIP === false && !isIPLiteral(parsed.host) && (options.domainHost || schemeHandler && schemeHandler.domainHost) && FORBIDDEN_DOMAIN_HOST_CHARACTER.test(parsed.host));
  }
  function isHostOnlyURL(url) {
    return url.username === "" && url.password === "" && url.port === "" && url.pathname === "/" && url.search === "" && url.hash === "" && url.hostname !== "";
  }
  function parseWithStatus(uri, opts) {
    const options = Object.assign({}, opts);
    const parsed = {
      scheme: undefined,
      userinfo: undefined,
      host: "",
      port: undefined,
      path: "",
      query: undefined,
      fragment: undefined
    };
    let malformedAuthorityOrPort = false;
    let malformedPercentEncoding = false;
    let malformedSchemeSpecific = false;
    let malformedHost = false;
    let malformedIPLiteral = false;
    let malformedScheme = false;
    let isIP = false;
    if (options.reference === "suffix") {
      if (options.scheme) {
        uri = options.scheme + ":" + uri;
      } else {
        uri = "//" + uri;
      }
    }
    const authorityMatch = uri.match(AUTHORITY_PREFIX);
    if (authorityMatch !== null && authorityMatch[1].indexOf("\\") !== -1) {
      parsed.error = "URI authority must not contain a literal backslash.";
      malformedAuthorityOrPort = true;
    }
    const introducerMatch = uri.match(AUTHORITY_INTRODUCER_REGION);
    if (introducerMatch !== null) {
      const region = introducerMatch[1];
      const normalizedRegion = region.replace(/[\t\n\r]/g, "");
      if (normalizedRegion.length >= 2) {
        if (normalizedRegion.slice(0, 2) !== "//") {
          parsed.error = parsed.error || "URI authority must not contain a literal backslash.";
          malformedAuthorityOrPort = true;
        } else if (region.length !== normalizedRegion.length) {
          parsed.error = parsed.error || "URI authority introducer must not contain whitespace.";
          malformedAuthorityOrPort = true;
        }
      }
    }
    const matches = uri.match(URI_PARSE);
    if (matches) {
      parsed.scheme = matches[1];
      parsed.userinfo = matches[3];
      parsed.host = matches[4];
      parsed.port = parseInt(matches[5], 10);
      parsed.path = matches[6] || "";
      parsed.query = matches[7];
      parsed.fragment = matches[8];
      if (parsed.scheme !== undefined) {
        if (VALID_SCHEME.test(parsed.scheme)) {
          parsed.scheme = parsed.scheme.toLowerCase();
        } else {
          parsed.error = parsed.error || MALFORMED_SCHEME_ERROR;
          malformedScheme = true;
        }
      }
      malformedPercentEncoding = hasMalformedComponentPercentEncoding(matches);
      if (malformedPercentEncoding) {
        parsed.error = parsed.error || "URI contains malformed percent-encoding.";
      }
      if (isNaN(parsed.port)) {
        parsed.port = matches[5];
      }
      const parseError = getParseError(parsed, matches);
      if (parseError !== undefined) {
        parsed.error = parsed.error || parseError;
        malformedAuthorityOrPort = true;
      }
      if (parsed.host) {
        const ipv4result = isIPv4(parsed.host);
        if (ipv4result === false) {
          const bracketedIPLiteral = isIPLiteral(parsed.host);
          const hasIPLiteralBracket = parsed.host.indexOf("[") !== -1 || parsed.host.indexOf("]") !== -1;
          const ipv6result = normalizeIPv6(parsed.host);
          isIP = ipv6result.isIPV6 || ipv6result.isIPVFuture === true;
          malformedIPLiteral = hasIPLiteralBracket && (!bracketedIPLiteral || ipv6result.error === true);
          parsed.host = isIP ? ipv6result.host : ipv6result.host.toLowerCase();
          if (malformedIPLiteral) {
            parsed.error = parsed.error || MALFORMED_HOST_ERROR;
            malformedAuthorityOrPort = true;
          }
        } else {
          isIP = true;
        }
      }
      if (parsed.scheme === undefined && parsed.userinfo === undefined && parsed.host === undefined && parsed.port === undefined && parsed.query === undefined && !parsed.path) {
        parsed.reference = "same-document";
      } else if (parsed.scheme === undefined) {
        parsed.reference = "relative";
      } else if (parsed.fragment === undefined) {
        parsed.reference = "absolute";
      } else {
        parsed.reference = "uri";
      }
      if (options.reference && options.reference !== "suffix" && options.reference !== parsed.reference) {
        parsed.error = parsed.error || "URI is not a " + options.reference + " reference.";
      }
      const schemeHandler = getSchemeHandler(options.scheme || parsed.scheme);
      if (!malformedIPLiteral) {
        malformedHost = canonicalizeHost(parsed, options, schemeHandler, isIP);
      }
      if (uri.indexOf("%") !== -1 && parsed.host !== undefined && !malformedIPLiteral) {
        let host = isIP ? parsed.host : normalizePercentEncoding(parsed.host, true);
        if (!isIP) {
          host = normalizePercentEncoding(host.toLowerCase());
        }
        parsed.host = isIP || options.scheme !== "null" ? reescapeHostDelimiters(host, isIP) : host;
      }
      if (!schemeHandler || schemeHandler && !schemeHandler.skipNormalize) {
        if (parsed.path) {
          parsed.path = normalizePathEncoding(parsed.path);
        }
        if (parsed.query) {
          parsed.query = normalizeQueryFragmentEncoding(parsed.query);
        }
        if (parsed.fragment) {
          parsed.fragment = normalizeQueryFragmentEncoding(parsed.fragment);
        }
      }
      if (schemeHandler && schemeHandler.parse) {
        schemeHandler.parse(parsed, options);
        if (schemeHandler === SCHEMES.urn && parsed.nid === undefined) {
          malformedSchemeSpecific = true;
        }
      }
    } else {
      parsed.error = parsed.error || "URI can not be parsed.";
    }
    return { parsed, malformedAuthorityOrPort, malformedPercentEncoding, malformedSchemeSpecific, malformedHost, malformedScheme };
  }
  function parse(uri, opts) {
    return parseWithStatus(uri, opts).parsed;
  }
  function normalizeString(uri, opts) {
    return normalizeStringWithStatus(uri, opts).normalized;
  }
  function normalizeStringWithStatus(uri, opts) {
    const { parsed, malformedAuthorityOrPort, malformedPercentEncoding, malformedSchemeSpecific, malformedHost, malformedScheme } = parseWithStatus(uri, opts);
    return {
      normalized: malformedAuthorityOrPort || malformedPercentEncoding || malformedSchemeSpecific || malformedHost || malformedScheme ? uri : serialize(parsed, opts),
      malformedAuthorityOrPort,
      malformedPercentEncoding,
      malformedSchemeSpecific,
      malformedHost,
      malformedScheme
    };
  }
  function normalizeComparableURI(uri, opts) {
    if (typeof uri !== "string" && typeof uri !== "object") {
      return;
    }
    let value;
    try {
      value = typeof uri === "string" ? uri : serialize(uri, opts);
    } catch {
      return;
    }
    const { normalized, malformedAuthorityOrPort, malformedPercentEncoding, malformedSchemeSpecific, malformedHost, malformedScheme } = normalizeStringWithStatus(value, opts);
    return malformedAuthorityOrPort || malformedPercentEncoding || malformedSchemeSpecific || malformedHost || malformedScheme ? undefined : normalized;
  }
  var fastUri = {
    SCHEMES,
    normalize,
    resolve,
    resolveComponent,
    equal,
    serialize,
    parse
  };
  module.exports = fastUri;
  module.exports.default = fastUri;
  module.exports.fastUri = fastUri;
});

// ../../node_modules/ajv/dist/runtime/uri.js
var require_uri = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var uri = require_fast_uri();
  uri.code = 'require("ajv/dist/runtime/uri").default';
  exports.default = uri;
});

// ../../node_modules/ajv/dist/core.js
var require_core = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = undefined;
  var validate_1 = require_validate();
  Object.defineProperty(exports, "KeywordCxt", { enumerable: true, get: function() {
    return validate_1.KeywordCxt;
  } });
  var codegen_1 = require_codegen();
  Object.defineProperty(exports, "_", { enumerable: true, get: function() {
    return codegen_1._;
  } });
  Object.defineProperty(exports, "str", { enumerable: true, get: function() {
    return codegen_1.str;
  } });
  Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
    return codegen_1.stringify;
  } });
  Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
    return codegen_1.nil;
  } });
  Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
    return codegen_1.Name;
  } });
  Object.defineProperty(exports, "CodeGen", { enumerable: true, get: function() {
    return codegen_1.CodeGen;
  } });
  var validation_error_1 = require_validation_error();
  var ref_error_1 = require_ref_error();
  var rules_1 = require_rules();
  var compile_1 = require_compile();
  var codegen_2 = require_codegen();
  var resolve_1 = require_resolve();
  var dataType_1 = require_dataType();
  var util_1 = require_util();
  var $dataRefSchema = require_data();
  var uri_1 = require_uri();
  var defaultRegExp = (str, flags) => new RegExp(str, flags);
  defaultRegExp.code = "new RegExp";
  var META_IGNORE_OPTIONS = ["removeAdditional", "useDefaults", "coerceTypes"];
  var EXT_SCOPE_NAMES = new Set([
    "validate",
    "serialize",
    "parse",
    "wrapper",
    "root",
    "schema",
    "keyword",
    "pattern",
    "formats",
    "validate$data",
    "func",
    "obj",
    "Error"
  ]);
  var removedOptions = {
    errorDataPath: "",
    format: "`validateFormats: false` can be used instead.",
    nullable: '"nullable" keyword is supported by default.',
    jsonPointers: "Deprecated jsPropertySyntax can be used instead.",
    extendRefs: "Deprecated ignoreKeywordsWithRef can be used instead.",
    missingRefs: "Pass empty schema with $id that should be ignored to ajv.addSchema.",
    processCode: "Use option `code: {process: (code, schemaEnv: object) => string}`",
    sourceCode: "Use option `code: {source: true}`",
    strictDefaults: "It is default now, see option `strict`.",
    strictKeywords: "It is default now, see option `strict`.",
    uniqueItems: '"uniqueItems" keyword is always validated.',
    unknownFormats: "Disable strict mode or pass `true` to `ajv.addFormat` (or `formats` option).",
    cache: "Map is used as cache, schema object as key.",
    serialize: "Map is used as cache, schema object as key.",
    ajvErrors: "It is default now."
  };
  var deprecatedOptions = {
    ignoreKeywordsWithRef: "",
    jsPropertySyntax: "",
    unicode: '"minLength"/"maxLength" account for unicode characters by default.'
  };
  var MAX_EXPRESSION = 200;
  function requiredOptions(o) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0;
    const s = o.strict;
    const _optz = (_a = o.code) === null || _a === undefined ? undefined : _a.optimize;
    const optimize = _optz === true || _optz === undefined ? 1 : _optz || 0;
    const regExp = (_c = (_b = o.code) === null || _b === undefined ? undefined : _b.regExp) !== null && _c !== undefined ? _c : defaultRegExp;
    const uriResolver = (_d = o.uriResolver) !== null && _d !== undefined ? _d : uri_1.default;
    return {
      strictSchema: (_f = (_e = o.strictSchema) !== null && _e !== undefined ? _e : s) !== null && _f !== undefined ? _f : true,
      strictNumbers: (_h = (_g = o.strictNumbers) !== null && _g !== undefined ? _g : s) !== null && _h !== undefined ? _h : true,
      strictTypes: (_k = (_j = o.strictTypes) !== null && _j !== undefined ? _j : s) !== null && _k !== undefined ? _k : "log",
      strictTuples: (_m = (_l = o.strictTuples) !== null && _l !== undefined ? _l : s) !== null && _m !== undefined ? _m : "log",
      strictRequired: (_p = (_o = o.strictRequired) !== null && _o !== undefined ? _o : s) !== null && _p !== undefined ? _p : false,
      code: o.code ? { ...o.code, optimize, regExp } : { optimize, regExp },
      loopRequired: (_q = o.loopRequired) !== null && _q !== undefined ? _q : MAX_EXPRESSION,
      loopEnum: (_r = o.loopEnum) !== null && _r !== undefined ? _r : MAX_EXPRESSION,
      meta: (_s = o.meta) !== null && _s !== undefined ? _s : true,
      messages: (_t = o.messages) !== null && _t !== undefined ? _t : true,
      inlineRefs: (_u = o.inlineRefs) !== null && _u !== undefined ? _u : true,
      schemaId: (_v = o.schemaId) !== null && _v !== undefined ? _v : "$id",
      addUsedSchema: (_w = o.addUsedSchema) !== null && _w !== undefined ? _w : true,
      validateSchema: (_x = o.validateSchema) !== null && _x !== undefined ? _x : true,
      validateFormats: (_y = o.validateFormats) !== null && _y !== undefined ? _y : true,
      unicodeRegExp: (_z = o.unicodeRegExp) !== null && _z !== undefined ? _z : true,
      int32range: (_0 = o.int32range) !== null && _0 !== undefined ? _0 : true,
      uriResolver
    };
  }

  class Ajv {
    constructor(opts = {}) {
      this.schemas = {};
      this.refs = {};
      this.formats = Object.create(null);
      this._compilations = new Set;
      this._loading = {};
      this._cache = new Map;
      opts = this.opts = { ...opts, ...requiredOptions(opts) };
      const { es5, lines } = this.opts.code;
      this.scope = new codegen_2.ValueScope({ scope: {}, prefixes: EXT_SCOPE_NAMES, es5, lines });
      this.logger = getLogger(opts.logger);
      const formatOpt = opts.validateFormats;
      opts.validateFormats = false;
      this.RULES = (0, rules_1.getRules)();
      checkOptions.call(this, removedOptions, opts, "NOT SUPPORTED");
      checkOptions.call(this, deprecatedOptions, opts, "DEPRECATED", "warn");
      this._metaOpts = getMetaSchemaOptions.call(this);
      if (opts.formats)
        addInitialFormats.call(this);
      this._addVocabularies();
      this._addDefaultMetaSchema();
      if (opts.keywords)
        addInitialKeywords.call(this, opts.keywords);
      if (typeof opts.meta == "object")
        this.addMetaSchema(opts.meta);
      addInitialSchemas.call(this);
      opts.validateFormats = formatOpt;
    }
    _addVocabularies() {
      this.addKeyword("$async");
    }
    _addDefaultMetaSchema() {
      const { $data, meta, schemaId } = this.opts;
      let _dataRefSchema = $dataRefSchema;
      if (schemaId === "id") {
        _dataRefSchema = { ...$dataRefSchema };
        _dataRefSchema.id = _dataRefSchema.$id;
        delete _dataRefSchema.$id;
      }
      if (meta && $data)
        this.addMetaSchema(_dataRefSchema, _dataRefSchema[schemaId], false);
    }
    defaultMeta() {
      const { meta, schemaId } = this.opts;
      return this.opts.defaultMeta = typeof meta == "object" ? meta[schemaId] || meta : undefined;
    }
    validate(schemaKeyRef, data) {
      let v;
      if (typeof schemaKeyRef == "string") {
        v = this.getSchema(schemaKeyRef);
        if (!v)
          throw new Error(`no schema with key or ref "${schemaKeyRef}"`);
      } else {
        v = this.compile(schemaKeyRef);
      }
      const valid = v(data);
      if (!("$async" in v))
        this.errors = v.errors;
      return valid;
    }
    compile(schema, _meta) {
      const sch = this._addSchema(schema, _meta);
      return sch.validate || this._compileSchemaEnv(sch);
    }
    compileAsync(schema, meta) {
      if (typeof this.opts.loadSchema != "function") {
        throw new Error("options.loadSchema should be a function");
      }
      const { loadSchema } = this.opts;
      return runCompileAsync.call(this, schema, meta);
      async function runCompileAsync(_schema, _meta) {
        await loadMetaSchema.call(this, _schema.$schema);
        const sch = this._addSchema(_schema, _meta);
        return sch.validate || _compileAsync.call(this, sch);
      }
      async function loadMetaSchema($ref) {
        if ($ref && !this.getSchema($ref)) {
          await runCompileAsync.call(this, { $ref }, true);
        }
      }
      async function _compileAsync(sch) {
        try {
          return this._compileSchemaEnv(sch);
        } catch (e) {
          if (!(e instanceof ref_error_1.default))
            throw e;
          checkLoaded.call(this, e);
          await loadMissingSchema.call(this, e.missingSchema);
          return _compileAsync.call(this, sch);
        }
      }
      function checkLoaded({ missingSchema: ref, missingRef }) {
        if (this.refs[ref]) {
          throw new Error(`AnySchema ${ref} is loaded but ${missingRef} cannot be resolved`);
        }
      }
      async function loadMissingSchema(ref) {
        const _schema = await _loadSchema.call(this, ref);
        if (!this.refs[ref])
          await loadMetaSchema.call(this, _schema.$schema);
        if (!this.refs[ref])
          this.addSchema(_schema, ref, meta);
      }
      async function _loadSchema(ref) {
        const p = this._loading[ref];
        if (p)
          return p;
        try {
          return await (this._loading[ref] = loadSchema(ref));
        } finally {
          delete this._loading[ref];
        }
      }
    }
    addSchema(schema, key, _meta, _validateSchema = this.opts.validateSchema) {
      if (Array.isArray(schema)) {
        for (const sch of schema)
          this.addSchema(sch, undefined, _meta, _validateSchema);
        return this;
      }
      let id;
      if (typeof schema === "object") {
        const { schemaId } = this.opts;
        id = schema[schemaId];
        if (id !== undefined && typeof id != "string") {
          throw new Error(`schema ${schemaId} must be string`);
        }
      }
      key = (0, resolve_1.normalizeId)(key || id);
      this._checkUnique(key);
      this.schemas[key] = this._addSchema(schema, _meta, key, _validateSchema, true);
      return this;
    }
    addMetaSchema(schema, key, _validateSchema = this.opts.validateSchema) {
      this.addSchema(schema, key, true, _validateSchema);
      return this;
    }
    validateSchema(schema, throwOrLogError) {
      if (typeof schema == "boolean")
        return true;
      let $schema;
      $schema = schema.$schema;
      if ($schema !== undefined && typeof $schema != "string") {
        throw new Error("$schema must be a string");
      }
      $schema = $schema || this.opts.defaultMeta || this.defaultMeta();
      if (!$schema) {
        this.logger.warn("meta-schema not available");
        this.errors = null;
        return true;
      }
      const valid = this.validate($schema, schema);
      if (!valid && throwOrLogError) {
        const message = "schema is invalid: " + this.errorsText();
        if (this.opts.validateSchema === "log")
          this.logger.error(message);
        else
          throw new Error(message);
      }
      return valid;
    }
    getSchema(keyRef) {
      let sch;
      while (typeof (sch = getSchEnv.call(this, keyRef)) == "string")
        keyRef = sch;
      if (sch === undefined) {
        const { schemaId } = this.opts;
        const root = new compile_1.SchemaEnv({ schema: {}, schemaId });
        sch = compile_1.resolveSchema.call(this, root, keyRef);
        if (!sch)
          return;
        this.refs[keyRef] = sch;
      }
      return sch.validate || this._compileSchemaEnv(sch);
    }
    removeSchema(schemaKeyRef) {
      if (schemaKeyRef instanceof RegExp) {
        this._removeAllSchemas(this.schemas, schemaKeyRef);
        this._removeAllSchemas(this.refs, schemaKeyRef);
        return this;
      }
      switch (typeof schemaKeyRef) {
        case "undefined":
          this._removeAllSchemas(this.schemas);
          this._removeAllSchemas(this.refs);
          this._cache.clear();
          return this;
        case "string": {
          const sch = getSchEnv.call(this, schemaKeyRef);
          if (typeof sch == "object")
            this._cache.delete(sch.schema);
          delete this.schemas[schemaKeyRef];
          delete this.refs[schemaKeyRef];
          return this;
        }
        case "object": {
          const cacheKey = schemaKeyRef;
          this._cache.delete(cacheKey);
          let id = schemaKeyRef[this.opts.schemaId];
          if (id) {
            id = (0, resolve_1.normalizeId)(id);
            delete this.schemas[id];
            delete this.refs[id];
          }
          return this;
        }
        default:
          throw new Error("ajv.removeSchema: invalid parameter");
      }
    }
    addVocabulary(definitions) {
      for (const def of definitions)
        this.addKeyword(def);
      return this;
    }
    addKeyword(kwdOrDef, def) {
      let keyword;
      if (typeof kwdOrDef == "string") {
        keyword = kwdOrDef;
        if (typeof def == "object") {
          this.logger.warn("these parameters are deprecated, see docs for addKeyword");
          def.keyword = keyword;
        }
      } else if (typeof kwdOrDef == "object" && def === undefined) {
        def = kwdOrDef;
        keyword = def.keyword;
        if (Array.isArray(keyword) && !keyword.length) {
          throw new Error("addKeywords: keyword must be string or non-empty array");
        }
      } else {
        throw new Error("invalid addKeywords parameters");
      }
      checkKeyword.call(this, keyword, def);
      if (!def) {
        (0, util_1.eachItem)(keyword, (kwd) => addRule.call(this, kwd));
        return this;
      }
      keywordMetaschema.call(this, def);
      const definition = {
        ...def,
        type: (0, dataType_1.getJSONTypes)(def.type),
        schemaType: (0, dataType_1.getJSONTypes)(def.schemaType)
      };
      (0, util_1.eachItem)(keyword, definition.type.length === 0 ? (k) => addRule.call(this, k, definition) : (k) => definition.type.forEach((t) => addRule.call(this, k, definition, t)));
      return this;
    }
    getKeyword(keyword) {
      const rule = this.RULES.all[keyword];
      return typeof rule == "object" ? rule.definition : !!rule;
    }
    removeKeyword(keyword) {
      const { RULES } = this;
      delete RULES.keywords[keyword];
      delete RULES.all[keyword];
      for (const group of RULES.rules) {
        const i = group.rules.findIndex((rule) => rule.keyword === keyword);
        if (i >= 0)
          group.rules.splice(i, 1);
      }
      return this;
    }
    addFormat(name, format) {
      if (typeof format == "string")
        format = new RegExp(format);
      this.formats[name] = format;
      return this;
    }
    errorsText(errors = this.errors, { separator = ", ", dataVar = "data" } = {}) {
      if (!errors || errors.length === 0)
        return "No errors";
      return errors.map((e) => `${dataVar}${e.instancePath} ${e.message}`).reduce((text, msg) => text + separator + msg);
    }
    $dataMetaSchema(metaSchema, keywordsJsonPointers) {
      const rules = this.RULES.all;
      metaSchema = JSON.parse(JSON.stringify(metaSchema));
      for (const jsonPointer of keywordsJsonPointers) {
        const segments = jsonPointer.split("/").slice(1);
        let keywords = metaSchema;
        for (const seg of segments)
          keywords = keywords[seg];
        for (const key in rules) {
          const rule = rules[key];
          if (typeof rule != "object")
            continue;
          const { $data } = rule.definition;
          const schema = keywords[key];
          if ($data && schema)
            keywords[key] = schemaOrData(schema);
        }
      }
      return metaSchema;
    }
    _removeAllSchemas(schemas, regex) {
      for (const keyRef in schemas) {
        const sch = schemas[keyRef];
        if (!regex || regex.test(keyRef)) {
          if (typeof sch == "string") {
            delete schemas[keyRef];
          } else if (sch && !sch.meta) {
            this._cache.delete(sch.schema);
            delete schemas[keyRef];
          }
        }
      }
    }
    _addSchema(schema, meta, baseId, validateSchema = this.opts.validateSchema, addSchema = this.opts.addUsedSchema) {
      let id;
      const { schemaId } = this.opts;
      if (typeof schema == "object") {
        id = schema[schemaId];
      } else {
        if (this.opts.jtd)
          throw new Error("schema must be object");
        else if (typeof schema != "boolean")
          throw new Error("schema must be object or boolean");
      }
      let sch = this._cache.get(schema);
      if (sch !== undefined)
        return sch;
      baseId = (0, resolve_1.normalizeId)(id || baseId);
      const localRefs = resolve_1.getSchemaRefs.call(this, schema, baseId);
      sch = new compile_1.SchemaEnv({ schema, schemaId, meta, baseId, localRefs });
      this._cache.set(sch.schema, sch);
      if (addSchema && !baseId.startsWith("#")) {
        if (baseId)
          this._checkUnique(baseId);
        this.refs[baseId] = sch;
      }
      if (validateSchema)
        this.validateSchema(schema, true);
      return sch;
    }
    _checkUnique(id) {
      if (this.schemas[id] || this.refs[id]) {
        throw new Error(`schema with key or id "${id}" already exists`);
      }
    }
    _compileSchemaEnv(sch) {
      if (sch.meta)
        this._compileMetaSchema(sch);
      else
        compile_1.compileSchema.call(this, sch);
      if (!sch.validate)
        throw new Error("ajv implementation error");
      return sch.validate;
    }
    _compileMetaSchema(sch) {
      const currentOpts = this.opts;
      this.opts = this._metaOpts;
      try {
        compile_1.compileSchema.call(this, sch);
      } finally {
        this.opts = currentOpts;
      }
    }
  }
  Ajv.ValidationError = validation_error_1.default;
  Ajv.MissingRefError = ref_error_1.default;
  exports.default = Ajv;
  function checkOptions(checkOpts, options, msg, log = "error") {
    for (const key in checkOpts) {
      const opt = key;
      if (opt in options)
        this.logger[log](`${msg}: option ${key}. ${checkOpts[opt]}`);
    }
  }
  function getSchEnv(keyRef) {
    keyRef = (0, resolve_1.normalizeId)(keyRef);
    return this.schemas[keyRef] || this.refs[keyRef];
  }
  function addInitialSchemas() {
    const optsSchemas = this.opts.schemas;
    if (!optsSchemas)
      return;
    if (Array.isArray(optsSchemas))
      this.addSchema(optsSchemas);
    else
      for (const key in optsSchemas)
        this.addSchema(optsSchemas[key], key);
  }
  function addInitialFormats() {
    for (const name in this.opts.formats) {
      const format = this.opts.formats[name];
      if (format)
        this.addFormat(name, format);
    }
  }
  function addInitialKeywords(defs) {
    if (Array.isArray(defs)) {
      this.addVocabulary(defs);
      return;
    }
    this.logger.warn("keywords option as map is deprecated, pass array");
    for (const keyword in defs) {
      const def = defs[keyword];
      if (!def.keyword)
        def.keyword = keyword;
      this.addKeyword(def);
    }
  }
  function getMetaSchemaOptions() {
    const metaOpts = { ...this.opts };
    for (const opt of META_IGNORE_OPTIONS)
      delete metaOpts[opt];
    return metaOpts;
  }
  var noLogs = { log() {}, warn() {}, error() {} };
  function getLogger(logger) {
    if (logger === false)
      return noLogs;
    if (logger === undefined)
      return console;
    if (logger.log && logger.warn && logger.error)
      return logger;
    throw new Error("logger must implement log, warn and error methods");
  }
  var KEYWORD_NAME = /^[a-z_$][a-z0-9_$:-]*$/i;
  function checkKeyword(keyword, def) {
    const { RULES } = this;
    (0, util_1.eachItem)(keyword, (kwd) => {
      if (RULES.keywords[kwd])
        throw new Error(`Keyword ${kwd} is already defined`);
      if (!KEYWORD_NAME.test(kwd))
        throw new Error(`Keyword ${kwd} has invalid name`);
    });
    if (!def)
      return;
    if (def.$data && !(("code" in def) || ("validate" in def))) {
      throw new Error('$data keyword must have "code" or "validate" function');
    }
  }
  function addRule(keyword, definition, dataType) {
    var _a;
    const post = definition === null || definition === undefined ? undefined : definition.post;
    if (dataType && post)
      throw new Error('keyword with "post" flag cannot have "type"');
    const { RULES } = this;
    let ruleGroup = post ? RULES.post : RULES.rules.find(({ type: t }) => t === dataType);
    if (!ruleGroup) {
      ruleGroup = { type: dataType, rules: [] };
      RULES.rules.push(ruleGroup);
    }
    RULES.keywords[keyword] = true;
    if (!definition)
      return;
    const rule = {
      keyword,
      definition: {
        ...definition,
        type: (0, dataType_1.getJSONTypes)(definition.type),
        schemaType: (0, dataType_1.getJSONTypes)(definition.schemaType)
      }
    };
    if (definition.before)
      addBeforeRule.call(this, ruleGroup, rule, definition.before);
    else
      ruleGroup.rules.push(rule);
    RULES.all[keyword] = rule;
    (_a = definition.implements) === null || _a === undefined || _a.forEach((kwd) => this.addKeyword(kwd));
  }
  function addBeforeRule(ruleGroup, rule, before) {
    const i = ruleGroup.rules.findIndex((_rule) => _rule.keyword === before);
    if (i >= 0) {
      ruleGroup.rules.splice(i, 0, rule);
    } else {
      ruleGroup.rules.push(rule);
      this.logger.warn(`rule ${before} is not defined`);
    }
  }
  function keywordMetaschema(def) {
    let { metaSchema } = def;
    if (metaSchema === undefined)
      return;
    if (def.$data && this.opts.$data)
      metaSchema = schemaOrData(metaSchema);
    def.validateSchema = this.compile(metaSchema, true);
  }
  var $dataRef = {
    $ref: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#"
  };
  function schemaOrData(schema) {
    return { anyOf: [schema, $dataRef] };
  }
});

// ../../node_modules/ajv/dist/vocabularies/core/id.js
var require_id = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var def = {
    keyword: "id",
    code() {
      throw new Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/core/ref.js
var require_ref = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.callRef = exports.getValidate = undefined;
  var ref_error_1 = require_ref_error();
  var code_1 = require_code2();
  var codegen_1 = require_codegen();
  var names_1 = require_names();
  var compile_1 = require_compile();
  var util_1 = require_util();
  var def = {
    keyword: "$ref",
    schemaType: "string",
    code(cxt) {
      const { gen, schema: $ref, it } = cxt;
      const { baseId, schemaEnv: env, validateName, opts, self } = it;
      const { root } = env;
      if (($ref === "#" || $ref === "#/") && baseId === root.baseId)
        return callRootRef();
      const schOrEnv = compile_1.resolveRef.call(self, root, baseId, $ref);
      if (schOrEnv === undefined)
        throw new ref_error_1.default(it.opts.uriResolver, baseId, $ref);
      if (schOrEnv instanceof compile_1.SchemaEnv)
        return callValidate(schOrEnv);
      return inlineRefSchema(schOrEnv);
      function callRootRef() {
        if (env === root)
          return callRef(cxt, validateName, env, env.$async);
        const rootName = gen.scopeValue("root", { ref: root });
        return callRef(cxt, (0, codegen_1._)`${rootName}.validate`, root, root.$async);
      }
      function callValidate(sch) {
        const v = getValidate(cxt, sch);
        callRef(cxt, v, sch, sch.$async);
      }
      function inlineRefSchema(sch) {
        const schName = gen.scopeValue("schema", opts.code.source === true ? { ref: sch, code: (0, codegen_1.stringify)(sch) } : { ref: sch });
        const valid = gen.name("valid");
        const schCxt = cxt.subschema({
          schema: sch,
          dataTypes: [],
          schemaPath: codegen_1.nil,
          topSchemaRef: schName,
          errSchemaPath: $ref
        }, valid);
        cxt.mergeEvaluated(schCxt);
        cxt.ok(valid);
      }
    }
  };
  function getValidate(cxt, sch) {
    const { gen } = cxt;
    return sch.validate ? gen.scopeValue("validate", { ref: sch.validate }) : (0, codegen_1._)`${gen.scopeValue("wrapper", { ref: sch })}.validate`;
  }
  exports.getValidate = getValidate;
  function callRef(cxt, v, sch, $async) {
    const { gen, it } = cxt;
    const { allErrors, schemaEnv: env, opts } = it;
    const passCxt = opts.passContext ? names_1.default.this : codegen_1.nil;
    if ($async)
      callAsyncRef();
    else
      callSyncRef();
    function callAsyncRef() {
      if (!env.$async)
        throw new Error("async schema referenced by sync schema");
      const valid = gen.let("valid");
      gen.try(() => {
        gen.code((0, codegen_1._)`await ${(0, code_1.callValidateCode)(cxt, v, passCxt)}`);
        addEvaluatedFrom(v);
        if (!allErrors)
          gen.assign(valid, true);
      }, (e) => {
        gen.if((0, codegen_1._)`!(${e} instanceof ${it.ValidationError})`, () => gen.throw(e));
        addErrorsFrom(e);
        if (!allErrors)
          gen.assign(valid, false);
      });
      cxt.ok(valid);
    }
    function callSyncRef() {
      cxt.result((0, code_1.callValidateCode)(cxt, v, passCxt), () => addEvaluatedFrom(v), () => addErrorsFrom(v));
    }
    function addErrorsFrom(source) {
      const errs = (0, codegen_1._)`${source}.errors`;
      gen.assign(names_1.default.vErrors, (0, codegen_1._)`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`);
      gen.assign(names_1.default.errors, (0, codegen_1._)`${names_1.default.vErrors}.length`);
    }
    function addEvaluatedFrom(source) {
      var _a;
      if (!it.opts.unevaluated)
        return;
      const schEvaluated = (_a = sch === null || sch === undefined ? undefined : sch.validate) === null || _a === undefined ? undefined : _a.evaluated;
      if (it.props !== true) {
        if (schEvaluated && !schEvaluated.dynamicProps) {
          if (schEvaluated.props !== undefined) {
            it.props = util_1.mergeEvaluated.props(gen, schEvaluated.props, it.props);
          }
        } else {
          const props = gen.var("props", (0, codegen_1._)`${source}.evaluated.props`);
          it.props = util_1.mergeEvaluated.props(gen, props, it.props, codegen_1.Name);
        }
      }
      if (it.items !== true) {
        if (schEvaluated && !schEvaluated.dynamicItems) {
          if (schEvaluated.items !== undefined) {
            it.items = util_1.mergeEvaluated.items(gen, schEvaluated.items, it.items);
          }
        } else {
          const items = gen.var("items", (0, codegen_1._)`${source}.evaluated.items`);
          it.items = util_1.mergeEvaluated.items(gen, items, it.items, codegen_1.Name);
        }
      }
    }
  }
  exports.callRef = callRef;
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/core/index.js
var require_core2 = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var id_1 = require_id();
  var ref_1 = require_ref();
  var core = [
    "$schema",
    "$id",
    "$defs",
    "$vocabulary",
    { keyword: "$comment" },
    "definitions",
    id_1.default,
    ref_1.default
  ];
  exports.default = core;
});

// ../../node_modules/ajv/dist/vocabularies/validation/limitNumber.js
var require_limitNumber = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var ops = codegen_1.operators;
  var KWDs = {
    maximum: { okStr: "<=", ok: ops.LTE, fail: ops.GT },
    minimum: { okStr: ">=", ok: ops.GTE, fail: ops.LT },
    exclusiveMaximum: { okStr: "<", ok: ops.LT, fail: ops.GTE },
    exclusiveMinimum: { okStr: ">", ok: ops.GT, fail: ops.LTE }
  };
  var error = {
    message: ({ keyword, schemaCode }) => (0, codegen_1.str)`must be ${KWDs[keyword].okStr} ${schemaCode}`,
    params: ({ keyword, schemaCode }) => (0, codegen_1._)`{comparison: ${KWDs[keyword].okStr}, limit: ${schemaCode}}`
  };
  var def = {
    keyword: Object.keys(KWDs),
    type: "number",
    schemaType: "number",
    $data: true,
    error,
    code(cxt) {
      const { keyword, data, schemaCode } = cxt;
      cxt.fail$data((0, codegen_1._)`${data} ${KWDs[keyword].fail} ${schemaCode} || isNaN(${data})`);
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/validation/multipleOf.js
var require_multipleOf = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var error = {
    message: ({ schemaCode }) => (0, codegen_1.str)`must be multiple of ${schemaCode}`,
    params: ({ schemaCode }) => (0, codegen_1._)`{multipleOf: ${schemaCode}}`
  };
  var def = {
    keyword: "multipleOf",
    type: "number",
    schemaType: "number",
    $data: true,
    error,
    code(cxt) {
      const { gen, data, schemaCode, it } = cxt;
      const prec = it.opts.multipleOfPrecision;
      const res = gen.let("res");
      const invalid = prec ? (0, codegen_1._)`Math.abs(Math.round(${res}) - ${res}) > 1e-${prec}` : (0, codegen_1._)`${res} !== parseInt(${res})`;
      cxt.fail$data((0, codegen_1._)`(${schemaCode} === 0 || (${res} = ${data}/${schemaCode}, ${invalid}))`);
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  function ucs2length(str) {
    const len = str.length;
    let length = 0;
    let pos = 0;
    let value;
    while (pos < len) {
      length++;
      value = str.charCodeAt(pos++);
      if (value >= 55296 && value <= 56319 && pos < len) {
        value = str.charCodeAt(pos);
        if ((value & 64512) === 56320)
          pos++;
      }
    }
    return length;
  }
  exports.default = ucs2length;
  ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
});

// ../../node_modules/ajv/dist/vocabularies/validation/limitLength.js
var require_limitLength = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var ucs2length_1 = require_ucs2length();
  var error = {
    message({ keyword, schemaCode }) {
      const comp = keyword === "maxLength" ? "more" : "fewer";
      return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} characters`;
    },
    params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
  };
  var def = {
    keyword: ["maxLength", "minLength"],
    type: "string",
    schemaType: "number",
    $data: true,
    error,
    code(cxt) {
      const { keyword, data, schemaCode, it } = cxt;
      const op = keyword === "maxLength" ? codegen_1.operators.GT : codegen_1.operators.LT;
      const len = it.opts.unicode === false ? (0, codegen_1._)`${data}.length` : (0, codegen_1._)`${(0, util_1.useFunc)(cxt.gen, ucs2length_1.default)}(${data})`;
      cxt.fail$data((0, codegen_1._)`${len} ${op} ${schemaCode}`);
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/validation/pattern.js
var require_pattern = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var code_1 = require_code2();
  var util_1 = require_util();
  var codegen_1 = require_codegen();
  var error = {
    message: ({ schemaCode }) => (0, codegen_1.str)`must match pattern "${schemaCode}"`,
    params: ({ schemaCode }) => (0, codegen_1._)`{pattern: ${schemaCode}}`
  };
  var def = {
    keyword: "pattern",
    type: "string",
    schemaType: "string",
    $data: true,
    error,
    code(cxt) {
      const { gen, data, $data, schema, schemaCode, it } = cxt;
      const u = it.opts.unicodeRegExp ? "u" : "";
      if ($data) {
        const { regExp } = it.opts.code;
        const regExpCode = regExp.code === "new RegExp" ? (0, codegen_1._)`new RegExp` : (0, util_1.useFunc)(gen, regExp);
        const valid = gen.let("valid");
        gen.try(() => gen.assign(valid, (0, codegen_1._)`${regExpCode}(${schemaCode}, ${u}).test(${data})`), () => gen.assign(valid, false));
        cxt.fail$data((0, codegen_1._)`!${valid}`);
      } else {
        const regExp = (0, code_1.usePattern)(cxt, schema);
        cxt.fail$data((0, codegen_1._)`!${regExp}.test(${data})`);
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/validation/limitProperties.js
var require_limitProperties = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var error = {
    message({ keyword, schemaCode }) {
      const comp = keyword === "maxProperties" ? "more" : "fewer";
      return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} properties`;
    },
    params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
  };
  var def = {
    keyword: ["maxProperties", "minProperties"],
    type: "object",
    schemaType: "number",
    $data: true,
    error,
    code(cxt) {
      const { keyword, data, schemaCode } = cxt;
      const op = keyword === "maxProperties" ? codegen_1.operators.GT : codegen_1.operators.LT;
      cxt.fail$data((0, codegen_1._)`Object.keys(${data}).length ${op} ${schemaCode}`);
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/validation/required.js
var require_required = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var code_1 = require_code2();
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var error = {
    message: ({ params: { missingProperty } }) => (0, codegen_1.str)`must have required property '${missingProperty}'`,
    params: ({ params: { missingProperty } }) => (0, codegen_1._)`{missingProperty: ${missingProperty}}`
  };
  var def = {
    keyword: "required",
    type: "object",
    schemaType: "array",
    $data: true,
    error,
    code(cxt) {
      const { gen, schema, schemaCode, data, $data, it } = cxt;
      const { opts } = it;
      if (!$data && schema.length === 0)
        return;
      const useLoop = schema.length >= opts.loopRequired;
      if (it.allErrors)
        allErrorsMode();
      else
        exitOnErrorMode();
      if (opts.strictRequired) {
        const props = cxt.parentSchema.properties;
        const { definedProperties } = cxt.it;
        for (const requiredKey of schema) {
          if ((props === null || props === undefined ? undefined : props[requiredKey]) === undefined && !definedProperties.has(requiredKey)) {
            const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
            const msg = `required property "${requiredKey}" is not defined at "${schemaPath}" (strictRequired)`;
            (0, util_1.checkStrictMode)(it, msg, it.opts.strictRequired);
          }
        }
      }
      function allErrorsMode() {
        if (useLoop || $data) {
          cxt.block$data(codegen_1.nil, loopAllRequired);
        } else {
          for (const prop of schema) {
            (0, code_1.checkReportMissingProp)(cxt, prop);
          }
        }
      }
      function exitOnErrorMode() {
        const missing = gen.let("missing");
        if (useLoop || $data) {
          const valid = gen.let("valid", true);
          cxt.block$data(valid, () => loopUntilMissing(missing, valid));
          cxt.ok(valid);
        } else {
          gen.if((0, code_1.checkMissingProp)(cxt, schema, missing));
          (0, code_1.reportMissingProp)(cxt, missing);
          gen.else();
        }
      }
      function loopAllRequired() {
        gen.forOf("prop", schemaCode, (prop) => {
          cxt.setParams({ missingProperty: prop });
          gen.if((0, code_1.noPropertyInData)(gen, data, prop, opts.ownProperties), () => cxt.error());
        });
      }
      function loopUntilMissing(missing, valid) {
        cxt.setParams({ missingProperty: missing });
        gen.forOf(missing, schemaCode, () => {
          gen.assign(valid, (0, code_1.propertyInData)(gen, data, missing, opts.ownProperties));
          gen.if((0, codegen_1.not)(valid), () => {
            cxt.error();
            gen.break();
          });
        }, codegen_1.nil);
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/validation/limitItems.js
var require_limitItems = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var error = {
    message({ keyword, schemaCode }) {
      const comp = keyword === "maxItems" ? "more" : "fewer";
      return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} items`;
    },
    params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
  };
  var def = {
    keyword: ["maxItems", "minItems"],
    type: "array",
    schemaType: "number",
    $data: true,
    error,
    code(cxt) {
      const { keyword, data, schemaCode } = cxt;
      const op = keyword === "maxItems" ? codegen_1.operators.GT : codegen_1.operators.LT;
      cxt.fail$data((0, codegen_1._)`${data}.length ${op} ${schemaCode}`);
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/runtime/equal.js
var require_equal = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var equal = require_fast_deep_equal();
  equal.code = 'require("ajv/dist/runtime/equal").default';
  exports.default = equal;
});

// ../../node_modules/ajv/dist/vocabularies/validation/uniqueItems.js
var require_uniqueItems = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var dataType_1 = require_dataType();
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var equal_1 = require_equal();
  var error = {
    message: ({ params: { i, j } }) => (0, codegen_1.str)`must NOT have duplicate items (items ## ${j} and ${i} are identical)`,
    params: ({ params: { i, j } }) => (0, codegen_1._)`{i: ${i}, j: ${j}}`
  };
  var def = {
    keyword: "uniqueItems",
    type: "array",
    schemaType: "boolean",
    $data: true,
    error,
    code(cxt) {
      const { gen, data, $data, schema, parentSchema, schemaCode, it } = cxt;
      if (!$data && !schema)
        return;
      const valid = gen.let("valid");
      const itemTypes = parentSchema.items ? (0, dataType_1.getSchemaTypes)(parentSchema.items) : [];
      cxt.block$data(valid, validateUniqueItems, (0, codegen_1._)`${schemaCode} === false`);
      cxt.ok(valid);
      function validateUniqueItems() {
        const i = gen.let("i", (0, codegen_1._)`${data}.length`);
        const j = gen.let("j");
        cxt.setParams({ i, j });
        gen.assign(valid, true);
        gen.if((0, codegen_1._)`${i} > 1`, () => (canOptimize() ? loopN : loopN2)(i, j));
      }
      function canOptimize() {
        return itemTypes.length > 0 && !itemTypes.some((t) => t === "object" || t === "array");
      }
      function loopN(i, j) {
        const item = gen.name("item");
        const wrongType = (0, dataType_1.checkDataTypes)(itemTypes, item, it.opts.strictNumbers, dataType_1.DataType.Wrong);
        const indices = gen.const("indices", (0, codegen_1._)`{}`);
        gen.for((0, codegen_1._)`;${i}--;`, () => {
          gen.let(item, (0, codegen_1._)`${data}[${i}]`);
          gen.if(wrongType, (0, codegen_1._)`continue`);
          if (itemTypes.length > 1)
            gen.if((0, codegen_1._)`typeof ${item} == "string"`, (0, codegen_1._)`${item} += "_"`);
          gen.if((0, codegen_1._)`typeof ${indices}[${item}] == "number"`, () => {
            gen.assign(j, (0, codegen_1._)`${indices}[${item}]`);
            cxt.error();
            gen.assign(valid, false).break();
          }).code((0, codegen_1._)`${indices}[${item}] = ${i}`);
        });
      }
      function loopN2(i, j) {
        const eql = (0, util_1.useFunc)(gen, equal_1.default);
        const outer = gen.name("outer");
        gen.label(outer).for((0, codegen_1._)`;${i}--;`, () => gen.for((0, codegen_1._)`${j} = ${i}; ${j}--;`, () => gen.if((0, codegen_1._)`${eql}(${data}[${i}], ${data}[${j}])`, () => {
          cxt.error();
          gen.assign(valid, false).break(outer);
        })));
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/validation/const.js
var require_const = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var equal_1 = require_equal();
  var error = {
    message: "must be equal to constant",
    params: ({ schemaCode }) => (0, codegen_1._)`{allowedValue: ${schemaCode}}`
  };
  var def = {
    keyword: "const",
    $data: true,
    error,
    code(cxt) {
      const { gen, data, $data, schemaCode, schema } = cxt;
      if ($data || schema && typeof schema == "object") {
        cxt.fail$data((0, codegen_1._)`!${(0, util_1.useFunc)(gen, equal_1.default)}(${data}, ${schemaCode})`);
      } else {
        cxt.fail((0, codegen_1._)`${schema} !== ${data}`);
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/validation/enum.js
var require_enum = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var equal_1 = require_equal();
  var error = {
    message: "must be equal to one of the allowed values",
    params: ({ schemaCode }) => (0, codegen_1._)`{allowedValues: ${schemaCode}}`
  };
  var def = {
    keyword: "enum",
    schemaType: "array",
    $data: true,
    error,
    code(cxt) {
      const { gen, data, $data, schema, schemaCode, it } = cxt;
      if (!$data && schema.length === 0)
        throw new Error("enum must have non-empty array");
      const useLoop = schema.length >= it.opts.loopEnum;
      let eql;
      const getEql = () => eql !== null && eql !== undefined ? eql : eql = (0, util_1.useFunc)(gen, equal_1.default);
      let valid;
      if (useLoop || $data) {
        valid = gen.let("valid");
        cxt.block$data(valid, loopEnum);
      } else {
        if (!Array.isArray(schema))
          throw new Error("ajv implementation error");
        const vSchema = gen.const("vSchema", schemaCode);
        valid = (0, codegen_1.or)(...schema.map((_x, i) => equalCode(vSchema, i)));
      }
      cxt.pass(valid);
      function loopEnum() {
        gen.assign(valid, false);
        gen.forOf("v", schemaCode, (v) => gen.if((0, codegen_1._)`${getEql()}(${data}, ${v})`, () => gen.assign(valid, true).break()));
      }
      function equalCode(vSchema, i) {
        const sch = schema[i];
        return typeof sch === "object" && sch !== null ? (0, codegen_1._)`${getEql()}(${data}, ${vSchema}[${i}])` : (0, codegen_1._)`${data} === ${sch}`;
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/validation/index.js
var require_validation = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var limitNumber_1 = require_limitNumber();
  var multipleOf_1 = require_multipleOf();
  var limitLength_1 = require_limitLength();
  var pattern_1 = require_pattern();
  var limitProperties_1 = require_limitProperties();
  var required_1 = require_required();
  var limitItems_1 = require_limitItems();
  var uniqueItems_1 = require_uniqueItems();
  var const_1 = require_const();
  var enum_1 = require_enum();
  var validation = [
    limitNumber_1.default,
    multipleOf_1.default,
    limitLength_1.default,
    pattern_1.default,
    limitProperties_1.default,
    required_1.default,
    limitItems_1.default,
    uniqueItems_1.default,
    { keyword: "type", schemaType: ["string", "array"] },
    { keyword: "nullable", schemaType: "boolean" },
    const_1.default,
    enum_1.default
  ];
  exports.default = validation;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/additionalItems.js
var require_additionalItems = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.validateAdditionalItems = undefined;
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var error = {
    message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
    params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
  };
  var def = {
    keyword: "additionalItems",
    type: "array",
    schemaType: ["boolean", "object"],
    before: "uniqueItems",
    error,
    code(cxt) {
      const { parentSchema, it } = cxt;
      const { items } = parentSchema;
      if (!Array.isArray(items)) {
        (0, util_1.checkStrictMode)(it, '"additionalItems" is ignored when "items" is not an array of schemas');
        return;
      }
      validateAdditionalItems(cxt, items);
    }
  };
  function validateAdditionalItems(cxt, items) {
    const { gen, schema, data, keyword, it } = cxt;
    it.items = true;
    const len = gen.const("len", (0, codegen_1._)`${data}.length`);
    if (schema === false) {
      cxt.setParams({ len: items.length });
      cxt.pass((0, codegen_1._)`${len} <= ${items.length}`);
    } else if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
      const valid = gen.var("valid", (0, codegen_1._)`${len} <= ${items.length}`);
      gen.if((0, codegen_1.not)(valid), () => validateItems(valid));
      cxt.ok(valid);
    }
    function validateItems(valid) {
      gen.forRange("i", items.length, len, (i) => {
        cxt.subschema({ keyword, dataProp: i, dataPropType: util_1.Type.Num }, valid);
        if (!it.allErrors)
          gen.if((0, codegen_1.not)(valid), () => gen.break());
      });
    }
  }
  exports.validateAdditionalItems = validateAdditionalItems;
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/items.js
var require_items = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.validateTuple = undefined;
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var code_1 = require_code2();
  var def = {
    keyword: "items",
    type: "array",
    schemaType: ["object", "array", "boolean"],
    before: "uniqueItems",
    code(cxt) {
      const { schema, it } = cxt;
      if (Array.isArray(schema))
        return validateTuple(cxt, "additionalItems", schema);
      it.items = true;
      if ((0, util_1.alwaysValidSchema)(it, schema))
        return;
      cxt.ok((0, code_1.validateArray)(cxt));
    }
  };
  function validateTuple(cxt, extraItems, schArr = cxt.schema) {
    const { gen, parentSchema, data, keyword, it } = cxt;
    checkStrictTuple(parentSchema);
    if (it.opts.unevaluated && schArr.length && it.items !== true) {
      it.items = util_1.mergeEvaluated.items(gen, schArr.length, it.items);
    }
    const valid = gen.name("valid");
    const len = gen.const("len", (0, codegen_1._)`${data}.length`);
    schArr.forEach((sch, i) => {
      if ((0, util_1.alwaysValidSchema)(it, sch))
        return;
      gen.if((0, codegen_1._)`${len} > ${i}`, () => cxt.subschema({
        keyword,
        schemaProp: i,
        dataProp: i
      }, valid));
      cxt.ok(valid);
    });
    function checkStrictTuple(sch) {
      const { opts, errSchemaPath } = it;
      const l = schArr.length;
      const fullTuple = l === sch.minItems && (l === sch.maxItems || sch[extraItems] === false);
      if (opts.strictTuples && !fullTuple) {
        const msg = `"${keyword}" is ${l}-tuple, but minItems or maxItems/${extraItems} are not specified or different at path "${errSchemaPath}"`;
        (0, util_1.checkStrictMode)(it, msg, opts.strictTuples);
      }
    }
  }
  exports.validateTuple = validateTuple;
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/prefixItems.js
var require_prefixItems = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var items_1 = require_items();
  var def = {
    keyword: "prefixItems",
    type: "array",
    schemaType: ["array"],
    before: "uniqueItems",
    code: (cxt) => (0, items_1.validateTuple)(cxt, "items")
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/items2020.js
var require_items2020 = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var code_1 = require_code2();
  var additionalItems_1 = require_additionalItems();
  var error = {
    message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
    params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
  };
  var def = {
    keyword: "items",
    type: "array",
    schemaType: ["object", "boolean"],
    before: "uniqueItems",
    error,
    code(cxt) {
      const { schema, parentSchema, it } = cxt;
      const { prefixItems } = parentSchema;
      it.items = true;
      if ((0, util_1.alwaysValidSchema)(it, schema))
        return;
      if (prefixItems)
        (0, additionalItems_1.validateAdditionalItems)(cxt, prefixItems);
      else
        cxt.ok((0, code_1.validateArray)(cxt));
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/contains.js
var require_contains = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var error = {
    message: ({ params: { min, max } }) => max === undefined ? (0, codegen_1.str)`must contain at least ${min} valid item(s)` : (0, codegen_1.str)`must contain at least ${min} and no more than ${max} valid item(s)`,
    params: ({ params: { min, max } }) => max === undefined ? (0, codegen_1._)`{minContains: ${min}}` : (0, codegen_1._)`{minContains: ${min}, maxContains: ${max}}`
  };
  var def = {
    keyword: "contains",
    type: "array",
    schemaType: ["object", "boolean"],
    before: "uniqueItems",
    trackErrors: true,
    error,
    code(cxt) {
      const { gen, schema, parentSchema, data, it } = cxt;
      let min;
      let max;
      const { minContains, maxContains } = parentSchema;
      if (it.opts.next) {
        min = minContains === undefined ? 1 : minContains;
        max = maxContains;
      } else {
        min = 1;
      }
      const len = gen.const("len", (0, codegen_1._)`${data}.length`);
      cxt.setParams({ min, max });
      if (max === undefined && min === 0) {
        (0, util_1.checkStrictMode)(it, `"minContains" == 0 without "maxContains": "contains" keyword ignored`);
        return;
      }
      if (max !== undefined && min > max) {
        (0, util_1.checkStrictMode)(it, `"minContains" > "maxContains" is always invalid`);
        cxt.fail();
        return;
      }
      if ((0, util_1.alwaysValidSchema)(it, schema)) {
        let cond = (0, codegen_1._)`${len} >= ${min}`;
        if (max !== undefined)
          cond = (0, codegen_1._)`${cond} && ${len} <= ${max}`;
        cxt.pass(cond);
        return;
      }
      it.items = true;
      const valid = gen.name("valid");
      if (max === undefined && min === 1) {
        validateItems(valid, () => gen.if(valid, () => gen.break()));
      } else if (min === 0) {
        gen.let(valid, true);
        if (max !== undefined)
          gen.if((0, codegen_1._)`${data}.length > 0`, validateItemsWithCount);
      } else {
        gen.let(valid, false);
        validateItemsWithCount();
      }
      cxt.result(valid, () => cxt.reset());
      function validateItemsWithCount() {
        const schValid = gen.name("_valid");
        const count = gen.let("count", 0);
        validateItems(schValid, () => gen.if(schValid, () => checkLimits(count)));
      }
      function validateItems(_valid, block) {
        gen.forRange("i", 0, len, (i) => {
          cxt.subschema({
            keyword: "contains",
            dataProp: i,
            dataPropType: util_1.Type.Num,
            compositeRule: true
          }, _valid);
          block();
        });
      }
      function checkLimits(count) {
        gen.code((0, codegen_1._)`${count}++`);
        if (max === undefined) {
          gen.if((0, codegen_1._)`${count} >= ${min}`, () => gen.assign(valid, true).break());
        } else {
          gen.if((0, codegen_1._)`${count} > ${max}`, () => gen.assign(valid, false).break());
          if (min === 1)
            gen.assign(valid, true);
          else
            gen.if((0, codegen_1._)`${count} >= ${min}`, () => gen.assign(valid, true));
        }
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/dependencies.js
var require_dependencies = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.validateSchemaDeps = exports.validatePropertyDeps = exports.error = undefined;
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var code_1 = require_code2();
  exports.error = {
    message: ({ params: { property, depsCount, deps } }) => {
      const property_ies = depsCount === 1 ? "property" : "properties";
      return (0, codegen_1.str)`must have ${property_ies} ${deps} when property ${property} is present`;
    },
    params: ({ params: { property, depsCount, deps, missingProperty } }) => (0, codegen_1._)`{property: ${property},
    missingProperty: ${missingProperty},
    depsCount: ${depsCount},
    deps: ${deps}}`
  };
  var def = {
    keyword: "dependencies",
    type: "object",
    schemaType: "object",
    error: exports.error,
    code(cxt) {
      const [propDeps, schDeps] = splitDependencies(cxt);
      validatePropertyDeps(cxt, propDeps);
      validateSchemaDeps(cxt, schDeps);
    }
  };
  function splitDependencies({ schema }) {
    const propertyDeps = {};
    const schemaDeps = {};
    for (const key in schema) {
      if (key === "__proto__")
        continue;
      const deps = Array.isArray(schema[key]) ? propertyDeps : schemaDeps;
      deps[key] = schema[key];
    }
    return [propertyDeps, schemaDeps];
  }
  function validatePropertyDeps(cxt, propertyDeps = cxt.schema) {
    const { gen, data, it } = cxt;
    if (Object.keys(propertyDeps).length === 0)
      return;
    const missing = gen.let("missing");
    for (const prop in propertyDeps) {
      const deps = propertyDeps[prop];
      if (deps.length === 0)
        continue;
      const hasProperty = (0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties);
      cxt.setParams({
        property: prop,
        depsCount: deps.length,
        deps: deps.join(", ")
      });
      if (it.allErrors) {
        gen.if(hasProperty, () => {
          for (const depProp of deps) {
            (0, code_1.checkReportMissingProp)(cxt, depProp);
          }
        });
      } else {
        gen.if((0, codegen_1._)`${hasProperty} && (${(0, code_1.checkMissingProp)(cxt, deps, missing)})`);
        (0, code_1.reportMissingProp)(cxt, missing);
        gen.else();
      }
    }
  }
  exports.validatePropertyDeps = validatePropertyDeps;
  function validateSchemaDeps(cxt, schemaDeps = cxt.schema) {
    const { gen, data, keyword, it } = cxt;
    const valid = gen.name("valid");
    for (const prop in schemaDeps) {
      if ((0, util_1.alwaysValidSchema)(it, schemaDeps[prop]))
        continue;
      gen.if((0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties), () => {
        const schCxt = cxt.subschema({ keyword, schemaProp: prop }, valid);
        cxt.mergeValidEvaluated(schCxt, valid);
      }, () => gen.var(valid, true));
      cxt.ok(valid);
    }
  }
  exports.validateSchemaDeps = validateSchemaDeps;
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/propertyNames.js
var require_propertyNames = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var error = {
    message: "property name must be valid",
    params: ({ params }) => (0, codegen_1._)`{propertyName: ${params.propertyName}}`
  };
  var def = {
    keyword: "propertyNames",
    type: "object",
    schemaType: ["object", "boolean"],
    error,
    code(cxt) {
      const { gen, schema, data, it } = cxt;
      if ((0, util_1.alwaysValidSchema)(it, schema))
        return;
      const valid = gen.name("valid");
      gen.forIn("key", data, (key) => {
        cxt.setParams({ propertyName: key });
        cxt.subschema({
          keyword: "propertyNames",
          data: key,
          dataTypes: ["string"],
          propertyName: key,
          compositeRule: true
        }, valid);
        gen.if((0, codegen_1.not)(valid), () => {
          cxt.error(true);
          if (!it.allErrors)
            gen.break();
        });
      });
      cxt.ok(valid);
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/additionalProperties.js
var require_additionalProperties = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var code_1 = require_code2();
  var codegen_1 = require_codegen();
  var names_1 = require_names();
  var util_1 = require_util();
  var error = {
    message: "must NOT have additional properties",
    params: ({ params }) => (0, codegen_1._)`{additionalProperty: ${params.additionalProperty}}`
  };
  var def = {
    keyword: "additionalProperties",
    type: ["object"],
    schemaType: ["boolean", "object"],
    allowUndefined: true,
    trackErrors: true,
    error,
    code(cxt) {
      const { gen, schema, parentSchema, data, errsCount, it } = cxt;
      if (!errsCount)
        throw new Error("ajv implementation error");
      const { allErrors, opts } = it;
      it.props = true;
      if (opts.removeAdditional !== "all" && (0, util_1.alwaysValidSchema)(it, schema))
        return;
      const props = (0, code_1.allSchemaProperties)(parentSchema.properties);
      const patProps = (0, code_1.allSchemaProperties)(parentSchema.patternProperties);
      checkAdditionalProperties();
      cxt.ok((0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
      function checkAdditionalProperties() {
        gen.forIn("key", data, (key) => {
          if (!props.length && !patProps.length)
            additionalPropertyCode(key);
          else
            gen.if(isAdditional(key), () => additionalPropertyCode(key));
        });
      }
      function isAdditional(key) {
        let definedProp;
        if (props.length > 8) {
          const propsSchema = (0, util_1.schemaRefOrVal)(it, parentSchema.properties, "properties");
          definedProp = (0, code_1.isOwnProperty)(gen, propsSchema, key);
        } else if (props.length) {
          definedProp = (0, codegen_1.or)(...props.map((p) => (0, codegen_1._)`${key} === ${p}`));
        } else {
          definedProp = codegen_1.nil;
        }
        if (patProps.length) {
          definedProp = (0, codegen_1.or)(definedProp, ...patProps.map((p) => (0, codegen_1._)`${(0, code_1.usePattern)(cxt, p)}.test(${key})`));
        }
        return (0, codegen_1.not)(definedProp);
      }
      function deleteAdditional(key) {
        gen.code((0, codegen_1._)`delete ${data}[${key}]`);
      }
      function additionalPropertyCode(key) {
        if (opts.removeAdditional === "all" || opts.removeAdditional && schema === false) {
          deleteAdditional(key);
          return;
        }
        if (schema === false) {
          cxt.setParams({ additionalProperty: key });
          cxt.error();
          if (!allErrors)
            gen.break();
          return;
        }
        if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
          const valid = gen.name("valid");
          if (opts.removeAdditional === "failing") {
            applyAdditionalSchema(key, valid, false);
            gen.if((0, codegen_1.not)(valid), () => {
              cxt.reset();
              deleteAdditional(key);
            });
          } else {
            applyAdditionalSchema(key, valid);
            if (!allErrors)
              gen.if((0, codegen_1.not)(valid), () => gen.break());
          }
        }
      }
      function applyAdditionalSchema(key, valid, errors) {
        const subschema = {
          keyword: "additionalProperties",
          dataProp: key,
          dataPropType: util_1.Type.Str
        };
        if (errors === false) {
          Object.assign(subschema, {
            compositeRule: true,
            createErrors: false,
            allErrors: false
          });
        }
        cxt.subschema(subschema, valid);
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/properties.js
var require_properties = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var validate_1 = require_validate();
  var code_1 = require_code2();
  var util_1 = require_util();
  var additionalProperties_1 = require_additionalProperties();
  var def = {
    keyword: "properties",
    type: "object",
    schemaType: "object",
    code(cxt) {
      const { gen, schema, parentSchema, data, it } = cxt;
      if (it.opts.removeAdditional === "all" && parentSchema.additionalProperties === undefined) {
        additionalProperties_1.default.code(new validate_1.KeywordCxt(it, additionalProperties_1.default, "additionalProperties"));
      }
      const allProps = (0, code_1.allSchemaProperties)(schema);
      for (const prop of allProps) {
        it.definedProperties.add(prop);
      }
      if (it.opts.unevaluated && allProps.length && it.props !== true) {
        it.props = util_1.mergeEvaluated.props(gen, (0, util_1.toHash)(allProps), it.props);
      }
      const properties = allProps.filter((p) => !(0, util_1.alwaysValidSchema)(it, schema[p]));
      if (properties.length === 0)
        return;
      const valid = gen.name("valid");
      for (const prop of properties) {
        if (hasDefault(prop)) {
          applyPropertySchema(prop);
        } else {
          gen.if((0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties));
          applyPropertySchema(prop);
          if (!it.allErrors)
            gen.else().var(valid, true);
          gen.endIf();
        }
        cxt.it.definedProperties.add(prop);
        cxt.ok(valid);
      }
      function hasDefault(prop) {
        return it.opts.useDefaults && !it.compositeRule && schema[prop].default !== undefined;
      }
      function applyPropertySchema(prop) {
        cxt.subschema({
          keyword: "properties",
          schemaProp: prop,
          dataProp: prop
        }, valid);
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/patternProperties.js
var require_patternProperties = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var code_1 = require_code2();
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var util_2 = require_util();
  var def = {
    keyword: "patternProperties",
    type: "object",
    schemaType: "object",
    code(cxt) {
      const { gen, schema, data, parentSchema, it } = cxt;
      const { opts } = it;
      const patterns = (0, code_1.allSchemaProperties)(schema);
      const alwaysValidPatterns = patterns.filter((p) => (0, util_1.alwaysValidSchema)(it, schema[p]));
      if (patterns.length === 0 || alwaysValidPatterns.length === patterns.length && (!it.opts.unevaluated || it.props === true)) {
        return;
      }
      const checkProperties = opts.strictSchema && !opts.allowMatchingProperties && parentSchema.properties;
      const valid = gen.name("valid");
      if (it.props !== true && !(it.props instanceof codegen_1.Name)) {
        it.props = (0, util_2.evaluatedPropsToName)(gen, it.props);
      }
      const { props } = it;
      validatePatternProperties();
      function validatePatternProperties() {
        for (const pat of patterns) {
          if (checkProperties)
            checkMatchingProperties(pat);
          if (it.allErrors) {
            validateProperties(pat);
          } else {
            gen.var(valid, true);
            validateProperties(pat);
            gen.if(valid);
          }
        }
      }
      function checkMatchingProperties(pat) {
        for (const prop in checkProperties) {
          if (new RegExp(pat).test(prop)) {
            (0, util_1.checkStrictMode)(it, `property ${prop} matches pattern ${pat} (use allowMatchingProperties)`);
          }
        }
      }
      function validateProperties(pat) {
        gen.forIn("key", data, (key) => {
          gen.if((0, codegen_1._)`${(0, code_1.usePattern)(cxt, pat)}.test(${key})`, () => {
            const alwaysValid = alwaysValidPatterns.includes(pat);
            if (!alwaysValid) {
              cxt.subschema({
                keyword: "patternProperties",
                schemaProp: pat,
                dataProp: key,
                dataPropType: util_2.Type.Str
              }, valid);
            }
            if (it.opts.unevaluated && props !== true) {
              gen.assign((0, codegen_1._)`${props}[${key}]`, true);
            } else if (!alwaysValid && !it.allErrors) {
              gen.if((0, codegen_1.not)(valid), () => gen.break());
            }
          });
        });
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/not.js
var require_not = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var util_1 = require_util();
  var def = {
    keyword: "not",
    schemaType: ["object", "boolean"],
    trackErrors: true,
    code(cxt) {
      const { gen, schema, it } = cxt;
      if ((0, util_1.alwaysValidSchema)(it, schema)) {
        cxt.fail();
        return;
      }
      const valid = gen.name("valid");
      cxt.subschema({
        keyword: "not",
        compositeRule: true,
        createErrors: false,
        allErrors: false
      }, valid);
      cxt.failResult(valid, () => cxt.reset(), () => cxt.error());
    },
    error: { message: "must NOT be valid" }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/anyOf.js
var require_anyOf = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var code_1 = require_code2();
  var def = {
    keyword: "anyOf",
    schemaType: "array",
    trackErrors: true,
    code: code_1.validateUnion,
    error: { message: "must match a schema in anyOf" }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/oneOf.js
var require_oneOf = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var error = {
    message: "must match exactly one schema in oneOf",
    params: ({ params }) => (0, codegen_1._)`{passingSchemas: ${params.passing}}`
  };
  var def = {
    keyword: "oneOf",
    schemaType: "array",
    trackErrors: true,
    error,
    code(cxt) {
      const { gen, schema, parentSchema, it } = cxt;
      if (!Array.isArray(schema))
        throw new Error("ajv implementation error");
      if (it.opts.discriminator && parentSchema.discriminator)
        return;
      const schArr = schema;
      const valid = gen.let("valid", false);
      const passing = gen.let("passing", null);
      const schValid = gen.name("_valid");
      cxt.setParams({ passing });
      gen.block(validateOneOf);
      cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
      function validateOneOf() {
        schArr.forEach((sch, i) => {
          let schCxt;
          if ((0, util_1.alwaysValidSchema)(it, sch)) {
            gen.var(schValid, true);
          } else {
            schCxt = cxt.subschema({
              keyword: "oneOf",
              schemaProp: i,
              compositeRule: true
            }, schValid);
          }
          if (i > 0) {
            gen.if((0, codegen_1._)`${schValid} && ${valid}`).assign(valid, false).assign(passing, (0, codegen_1._)`[${passing}, ${i}]`).else();
          }
          gen.if(schValid, () => {
            gen.assign(valid, true);
            gen.assign(passing, i);
            if (schCxt)
              cxt.mergeEvaluated(schCxt, codegen_1.Name);
          });
        });
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/allOf.js
var require_allOf = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var util_1 = require_util();
  var def = {
    keyword: "allOf",
    schemaType: "array",
    code(cxt) {
      const { gen, schema, it } = cxt;
      if (!Array.isArray(schema))
        throw new Error("ajv implementation error");
      const valid = gen.name("valid");
      schema.forEach((sch, i) => {
        if ((0, util_1.alwaysValidSchema)(it, sch))
          return;
        const schCxt = cxt.subschema({ keyword: "allOf", schemaProp: i }, valid);
        cxt.ok(valid);
        cxt.mergeEvaluated(schCxt);
      });
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/if.js
var require_if = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var error = {
    message: ({ params }) => (0, codegen_1.str)`must match "${params.ifClause}" schema`,
    params: ({ params }) => (0, codegen_1._)`{failingKeyword: ${params.ifClause}}`
  };
  var def = {
    keyword: "if",
    schemaType: ["object", "boolean"],
    trackErrors: true,
    error,
    code(cxt) {
      const { gen, parentSchema, it } = cxt;
      if (parentSchema.then === undefined && parentSchema.else === undefined) {
        (0, util_1.checkStrictMode)(it, '"if" without "then" and "else" is ignored');
      }
      const hasThen = hasSchema(it, "then");
      const hasElse = hasSchema(it, "else");
      if (!hasThen && !hasElse)
        return;
      const valid = gen.let("valid", true);
      const schValid = gen.name("_valid");
      validateIf();
      cxt.reset();
      if (hasThen && hasElse) {
        const ifClause = gen.let("ifClause");
        cxt.setParams({ ifClause });
        gen.if(schValid, validateClause("then", ifClause), validateClause("else", ifClause));
      } else if (hasThen) {
        gen.if(schValid, validateClause("then"));
      } else {
        gen.if((0, codegen_1.not)(schValid), validateClause("else"));
      }
      cxt.pass(valid, () => cxt.error(true));
      function validateIf() {
        const schCxt = cxt.subschema({
          keyword: "if",
          compositeRule: true,
          createErrors: false,
          allErrors: false
        }, schValid);
        cxt.mergeEvaluated(schCxt);
      }
      function validateClause(keyword, ifClause) {
        return () => {
          const schCxt = cxt.subschema({ keyword }, schValid);
          gen.assign(valid, schValid);
          cxt.mergeValidEvaluated(schCxt, valid);
          if (ifClause)
            gen.assign(ifClause, (0, codegen_1._)`${keyword}`);
          else
            cxt.setParams({ ifClause: keyword });
        };
      }
    }
  };
  function hasSchema(it, keyword) {
    const schema = it.schema[keyword];
    return schema !== undefined && !(0, util_1.alwaysValidSchema)(it, schema);
  }
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/thenElse.js
var require_thenElse = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var util_1 = require_util();
  var def = {
    keyword: ["then", "else"],
    schemaType: ["object", "boolean"],
    code({ keyword, parentSchema, it }) {
      if (parentSchema.if === undefined)
        (0, util_1.checkStrictMode)(it, `"${keyword}" without "if" is ignored`);
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/index.js
var require_applicator = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var additionalItems_1 = require_additionalItems();
  var prefixItems_1 = require_prefixItems();
  var items_1 = require_items();
  var items2020_1 = require_items2020();
  var contains_1 = require_contains();
  var dependencies_1 = require_dependencies();
  var propertyNames_1 = require_propertyNames();
  var additionalProperties_1 = require_additionalProperties();
  var properties_1 = require_properties();
  var patternProperties_1 = require_patternProperties();
  var not_1 = require_not();
  var anyOf_1 = require_anyOf();
  var oneOf_1 = require_oneOf();
  var allOf_1 = require_allOf();
  var if_1 = require_if();
  var thenElse_1 = require_thenElse();
  function getApplicator(draft2020 = false) {
    const applicator = [
      not_1.default,
      anyOf_1.default,
      oneOf_1.default,
      allOf_1.default,
      if_1.default,
      thenElse_1.default,
      propertyNames_1.default,
      additionalProperties_1.default,
      dependencies_1.default,
      properties_1.default,
      patternProperties_1.default
    ];
    if (draft2020)
      applicator.push(prefixItems_1.default, items2020_1.default);
    else
      applicator.push(additionalItems_1.default, items_1.default);
    applicator.push(contains_1.default);
    return applicator;
  }
  exports.default = getApplicator;
});

// ../../node_modules/ajv/dist/vocabularies/dynamic/dynamicAnchor.js
var require_dynamicAnchor = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.dynamicAnchor = undefined;
  var codegen_1 = require_codegen();
  var names_1 = require_names();
  var compile_1 = require_compile();
  var ref_1 = require_ref();
  var def = {
    keyword: "$dynamicAnchor",
    schemaType: "string",
    code: (cxt) => dynamicAnchor(cxt, cxt.schema)
  };
  function dynamicAnchor(cxt, anchor) {
    const { gen, it } = cxt;
    it.schemaEnv.root.dynamicAnchors[anchor] = true;
    const v = (0, codegen_1._)`${names_1.default.dynamicAnchors}${(0, codegen_1.getProperty)(anchor)}`;
    const validate = it.errSchemaPath === "#" ? it.validateName : _getValidate(cxt);
    gen.if((0, codegen_1._)`!${v}`, () => gen.assign(v, validate));
  }
  exports.dynamicAnchor = dynamicAnchor;
  function _getValidate(cxt) {
    const { schemaEnv, schema, self } = cxt.it;
    const { root, baseId, localRefs, meta } = schemaEnv.root;
    const { schemaId } = self.opts;
    const sch = new compile_1.SchemaEnv({ schema, schemaId, root, baseId, localRefs, meta });
    compile_1.compileSchema.call(self, sch);
    return (0, ref_1.getValidate)(cxt, sch);
  }
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/dynamic/dynamicRef.js
var require_dynamicRef = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.dynamicRef = undefined;
  var codegen_1 = require_codegen();
  var names_1 = require_names();
  var ref_1 = require_ref();
  var def = {
    keyword: "$dynamicRef",
    schemaType: "string",
    code: (cxt) => dynamicRef(cxt, cxt.schema)
  };
  function dynamicRef(cxt, ref) {
    const { gen, keyword, it } = cxt;
    if (ref[0] !== "#")
      throw new Error(`"${keyword}" only supports hash fragment reference`);
    const anchor = ref.slice(1);
    if (it.allErrors) {
      _dynamicRef();
    } else {
      const valid = gen.let("valid", false);
      _dynamicRef(valid);
      cxt.ok(valid);
    }
    function _dynamicRef(valid) {
      if (it.schemaEnv.root.dynamicAnchors[anchor]) {
        const v = gen.let("_v", (0, codegen_1._)`${names_1.default.dynamicAnchors}${(0, codegen_1.getProperty)(anchor)}`);
        gen.if(v, _callRef(v, valid), _callRef(it.validateName, valid));
      } else {
        _callRef(it.validateName, valid)();
      }
    }
    function _callRef(validate, valid) {
      return valid ? () => gen.block(() => {
        (0, ref_1.callRef)(cxt, validate);
        gen.let(valid, true);
      }) : () => (0, ref_1.callRef)(cxt, validate);
    }
  }
  exports.dynamicRef = dynamicRef;
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/dynamic/recursiveAnchor.js
var require_recursiveAnchor = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var dynamicAnchor_1 = require_dynamicAnchor();
  var util_1 = require_util();
  var def = {
    keyword: "$recursiveAnchor",
    schemaType: "boolean",
    code(cxt) {
      if (cxt.schema)
        (0, dynamicAnchor_1.dynamicAnchor)(cxt, "");
      else
        (0, util_1.checkStrictMode)(cxt.it, "$recursiveAnchor: false is ignored");
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/dynamic/recursiveRef.js
var require_recursiveRef = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var dynamicRef_1 = require_dynamicRef();
  var def = {
    keyword: "$recursiveRef",
    schemaType: "string",
    code: (cxt) => (0, dynamicRef_1.dynamicRef)(cxt, cxt.schema)
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/dynamic/index.js
var require_dynamic = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var dynamicAnchor_1 = require_dynamicAnchor();
  var dynamicRef_1 = require_dynamicRef();
  var recursiveAnchor_1 = require_recursiveAnchor();
  var recursiveRef_1 = require_recursiveRef();
  var dynamic = [dynamicAnchor_1.default, dynamicRef_1.default, recursiveAnchor_1.default, recursiveRef_1.default];
  exports.default = dynamic;
});

// ../../node_modules/ajv/dist/vocabularies/validation/dependentRequired.js
var require_dependentRequired = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var dependencies_1 = require_dependencies();
  var def = {
    keyword: "dependentRequired",
    type: "object",
    schemaType: "object",
    error: dependencies_1.error,
    code: (cxt) => (0, dependencies_1.validatePropertyDeps)(cxt)
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/applicator/dependentSchemas.js
var require_dependentSchemas = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var dependencies_1 = require_dependencies();
  var def = {
    keyword: "dependentSchemas",
    type: "object",
    schemaType: "object",
    code: (cxt) => (0, dependencies_1.validateSchemaDeps)(cxt)
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/validation/limitContains.js
var require_limitContains = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var util_1 = require_util();
  var def = {
    keyword: ["maxContains", "minContains"],
    type: "array",
    schemaType: "number",
    code({ keyword, parentSchema, it }) {
      if (parentSchema.contains === undefined) {
        (0, util_1.checkStrictMode)(it, `"${keyword}" without "contains" is ignored`);
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/next.js
var require_next = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var dependentRequired_1 = require_dependentRequired();
  var dependentSchemas_1 = require_dependentSchemas();
  var limitContains_1 = require_limitContains();
  var next = [dependentRequired_1.default, dependentSchemas_1.default, limitContains_1.default];
  exports.default = next;
});

// ../../node_modules/ajv/dist/vocabularies/unevaluated/unevaluatedProperties.js
var require_unevaluatedProperties = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var names_1 = require_names();
  var error = {
    message: "must NOT have unevaluated properties",
    params: ({ params }) => (0, codegen_1._)`{unevaluatedProperty: ${params.unevaluatedProperty}}`
  };
  var def = {
    keyword: "unevaluatedProperties",
    type: "object",
    schemaType: ["boolean", "object"],
    trackErrors: true,
    error,
    code(cxt) {
      const { gen, schema, data, errsCount, it } = cxt;
      if (!errsCount)
        throw new Error("ajv implementation error");
      const { allErrors, props } = it;
      if (props instanceof codegen_1.Name) {
        gen.if((0, codegen_1._)`${props} !== true`, () => gen.forIn("key", data, (key) => gen.if(unevaluatedDynamic(props, key), () => unevaluatedPropCode(key))));
      } else if (props !== true) {
        gen.forIn("key", data, (key) => props === undefined ? unevaluatedPropCode(key) : gen.if(unevaluatedStatic(props, key), () => unevaluatedPropCode(key)));
      }
      it.props = true;
      cxt.ok((0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
      function unevaluatedPropCode(key) {
        if (schema === false) {
          cxt.setParams({ unevaluatedProperty: key });
          cxt.error();
          if (!allErrors)
            gen.break();
          return;
        }
        if (!(0, util_1.alwaysValidSchema)(it, schema)) {
          const valid = gen.name("valid");
          cxt.subschema({
            keyword: "unevaluatedProperties",
            dataProp: key,
            dataPropType: util_1.Type.Str
          }, valid);
          if (!allErrors)
            gen.if((0, codegen_1.not)(valid), () => gen.break());
        }
      }
      function unevaluatedDynamic(evaluatedProps, key) {
        return (0, codegen_1._)`!${evaluatedProps} || !${evaluatedProps}[${key}]`;
      }
      function unevaluatedStatic(evaluatedProps, key) {
        const ps = [];
        for (const p in evaluatedProps) {
          if (evaluatedProps[p] === true)
            ps.push((0, codegen_1._)`${key} !== ${p}`);
        }
        return (0, codegen_1.and)(...ps);
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/unevaluated/unevaluatedItems.js
var require_unevaluatedItems = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var util_1 = require_util();
  var error = {
    message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
    params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
  };
  var def = {
    keyword: "unevaluatedItems",
    type: "array",
    schemaType: ["boolean", "object"],
    error,
    code(cxt) {
      const { gen, schema, data, it } = cxt;
      const items = it.items || 0;
      if (items === true)
        return;
      const len = gen.const("len", (0, codegen_1._)`${data}.length`);
      if (schema === false) {
        cxt.setParams({ len: items });
        cxt.fail((0, codegen_1._)`${len} > ${items}`);
      } else if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
        const valid = gen.var("valid", (0, codegen_1._)`${len} <= ${items}`);
        gen.if((0, codegen_1.not)(valid), () => validateItems(valid, items));
        cxt.ok(valid);
      }
      it.items = true;
      function validateItems(valid, from) {
        gen.forRange("i", from, len, (i) => {
          cxt.subschema({ keyword: "unevaluatedItems", dataProp: i, dataPropType: util_1.Type.Num }, valid);
          if (!it.allErrors)
            gen.if((0, codegen_1.not)(valid), () => gen.break());
        });
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/unevaluated/index.js
var require_unevaluated = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var unevaluatedProperties_1 = require_unevaluatedProperties();
  var unevaluatedItems_1 = require_unevaluatedItems();
  var unevaluated = [unevaluatedProperties_1.default, unevaluatedItems_1.default];
  exports.default = unevaluated;
});

// ../../node_modules/ajv/dist/vocabularies/format/format.js
var require_format = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var error = {
    message: ({ schemaCode }) => (0, codegen_1.str)`must match format "${schemaCode}"`,
    params: ({ schemaCode }) => (0, codegen_1._)`{format: ${schemaCode}}`
  };
  var def = {
    keyword: "format",
    type: ["number", "string"],
    schemaType: "string",
    $data: true,
    error,
    code(cxt, ruleType) {
      const { gen, data, $data, schema, schemaCode, it } = cxt;
      const { opts, errSchemaPath, schemaEnv, self } = it;
      if (!opts.validateFormats)
        return;
      if ($data)
        validate$DataFormat();
      else
        validateFormat();
      function validate$DataFormat() {
        const fmts = gen.scopeValue("formats", {
          ref: self.formats,
          code: opts.code.formats
        });
        const fDef = gen.const("fDef", (0, codegen_1._)`${fmts}[${schemaCode}]`);
        const fType = gen.let("fType");
        const format = gen.let("format");
        gen.if((0, codegen_1._)`typeof ${fDef} == "object" && !(${fDef} instanceof RegExp)`, () => gen.assign(fType, (0, codegen_1._)`${fDef}.type || "string"`).assign(format, (0, codegen_1._)`${fDef}.validate`), () => gen.assign(fType, (0, codegen_1._)`"string"`).assign(format, fDef));
        cxt.fail$data((0, codegen_1.or)(unknownFmt(), invalidFmt()));
        function unknownFmt() {
          if (opts.strictSchema === false)
            return codegen_1.nil;
          return (0, codegen_1._)`${schemaCode} && !${format}`;
        }
        function invalidFmt() {
          const callFormat = schemaEnv.$async ? (0, codegen_1._)`(${fDef}.async ? await ${format}(${data}) : ${format}(${data}))` : (0, codegen_1._)`${format}(${data})`;
          const validData = (0, codegen_1._)`(typeof ${format} == "function" ? ${callFormat} : ${format}.test(${data}))`;
          return (0, codegen_1._)`${format} && ${format} !== true && ${fType} === ${ruleType} && !${validData}`;
        }
      }
      function validateFormat() {
        const formatDef = self.formats[schema];
        if (!formatDef) {
          unknownFormat();
          return;
        }
        if (formatDef === true)
          return;
        const [fmtType, format, fmtRef] = getFormat(formatDef);
        if (fmtType === ruleType)
          cxt.pass(validCondition());
        function unknownFormat() {
          if (opts.strictSchema === false) {
            self.logger.warn(unknownMsg());
            return;
          }
          throw new Error(unknownMsg());
          function unknownMsg() {
            return `unknown format "${schema}" ignored in schema at path "${errSchemaPath}"`;
          }
        }
        function getFormat(fmtDef) {
          const code = fmtDef instanceof RegExp ? (0, codegen_1.regexpCode)(fmtDef) : opts.code.formats ? (0, codegen_1._)`${opts.code.formats}${(0, codegen_1.getProperty)(schema)}` : undefined;
          const fmt = gen.scopeValue("formats", { key: schema, ref: fmtDef, code });
          if (typeof fmtDef == "object" && !(fmtDef instanceof RegExp)) {
            return [fmtDef.type || "string", fmtDef.validate, (0, codegen_1._)`${fmt}.validate`];
          }
          return ["string", fmtDef, fmt];
        }
        function validCondition() {
          if (typeof formatDef == "object" && !(formatDef instanceof RegExp) && formatDef.async) {
            if (!schemaEnv.$async)
              throw new Error("async format in sync schema");
            return (0, codegen_1._)`await ${fmtRef}(${data})`;
          }
          return typeof format == "function" ? (0, codegen_1._)`${fmtRef}(${data})` : (0, codegen_1._)`${fmtRef}.test(${data})`;
        }
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/vocabularies/format/index.js
var require_format2 = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var format_1 = require_format();
  var format = [format_1.default];
  exports.default = format;
});

// ../../node_modules/ajv/dist/vocabularies/metadata.js
var require_metadata = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.contentVocabulary = exports.metadataVocabulary = undefined;
  exports.metadataVocabulary = [
    "title",
    "description",
    "default",
    "deprecated",
    "readOnly",
    "writeOnly",
    "examples"
  ];
  exports.contentVocabulary = [
    "contentMediaType",
    "contentEncoding",
    "contentSchema"
  ];
});

// ../../node_modules/ajv/dist/vocabularies/draft2020.js
var require_draft2020 = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var core_1 = require_core2();
  var validation_1 = require_validation();
  var applicator_1 = require_applicator();
  var dynamic_1 = require_dynamic();
  var next_1 = require_next();
  var unevaluated_1 = require_unevaluated();
  var format_1 = require_format2();
  var metadata_1 = require_metadata();
  var draft2020Vocabularies = [
    dynamic_1.default,
    core_1.default,
    validation_1.default,
    (0, applicator_1.default)(true),
    format_1.default,
    metadata_1.metadataVocabulary,
    metadata_1.contentVocabulary,
    next_1.default,
    unevaluated_1.default
  ];
  exports.default = draft2020Vocabularies;
});

// ../../node_modules/ajv/dist/vocabularies/discriminator/types.js
var require_types = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.DiscrError = undefined;
  var DiscrError;
  (function(DiscrError) {
    DiscrError["Tag"] = "tag";
    DiscrError["Mapping"] = "mapping";
  })(DiscrError || (exports.DiscrError = DiscrError = {}));
});

// ../../node_modules/ajv/dist/vocabularies/discriminator/index.js
var require_discriminator = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var codegen_1 = require_codegen();
  var types_1 = require_types();
  var compile_1 = require_compile();
  var ref_error_1 = require_ref_error();
  var util_1 = require_util();
  var error = {
    message: ({ params: { discrError, tagName } }) => discrError === types_1.DiscrError.Tag ? `tag "${tagName}" must be string` : `value of tag "${tagName}" must be in oneOf`,
    params: ({ params: { discrError, tag, tagName } }) => (0, codegen_1._)`{error: ${discrError}, tag: ${tagName}, tagValue: ${tag}}`
  };
  var def = {
    keyword: "discriminator",
    type: "object",
    schemaType: "object",
    error,
    code(cxt) {
      const { gen, data, schema, parentSchema, it } = cxt;
      const { oneOf } = parentSchema;
      if (!it.opts.discriminator) {
        throw new Error("discriminator: requires discriminator option");
      }
      const tagName = schema.propertyName;
      if (typeof tagName != "string")
        throw new Error("discriminator: requires propertyName");
      if (schema.mapping)
        throw new Error("discriminator: mapping is not supported");
      if (!oneOf)
        throw new Error("discriminator: requires oneOf keyword");
      const valid = gen.let("valid", false);
      const tag = gen.const("tag", (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(tagName)}`);
      gen.if((0, codegen_1._)`typeof ${tag} == "string"`, () => validateMapping(), () => cxt.error(false, { discrError: types_1.DiscrError.Tag, tag, tagName }));
      cxt.ok(valid);
      function validateMapping() {
        const mapping = getMapping();
        gen.if(false);
        for (const tagValue in mapping) {
          gen.elseIf((0, codegen_1._)`${tag} === ${tagValue}`);
          gen.assign(valid, applyTagSchema(mapping[tagValue]));
        }
        gen.else();
        cxt.error(false, { discrError: types_1.DiscrError.Mapping, tag, tagName });
        gen.endIf();
      }
      function applyTagSchema(schemaProp) {
        const _valid = gen.name("valid");
        const schCxt = cxt.subschema({ keyword: "oneOf", schemaProp }, _valid);
        cxt.mergeEvaluated(schCxt, codegen_1.Name);
        return _valid;
      }
      function getMapping() {
        var _a;
        const oneOfMapping = {};
        const topRequired = hasRequired(parentSchema);
        let tagRequired = true;
        for (let i = 0;i < oneOf.length; i++) {
          let sch = oneOf[i];
          if ((sch === null || sch === undefined ? undefined : sch.$ref) && !(0, util_1.schemaHasRulesButRef)(sch, it.self.RULES)) {
            const ref = sch.$ref;
            sch = compile_1.resolveRef.call(it.self, it.schemaEnv.root, it.baseId, ref);
            if (sch instanceof compile_1.SchemaEnv)
              sch = sch.schema;
            if (sch === undefined)
              throw new ref_error_1.default(it.opts.uriResolver, it.baseId, ref);
          }
          const propSch = (_a = sch === null || sch === undefined ? undefined : sch.properties) === null || _a === undefined ? undefined : _a[tagName];
          if (typeof propSch != "object") {
            throw new Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${tagName}"`);
          }
          tagRequired = tagRequired && (topRequired || hasRequired(sch));
          addMappings(propSch, i);
        }
        if (!tagRequired)
          throw new Error(`discriminator: "${tagName}" must be required`);
        return oneOfMapping;
        function hasRequired({ required }) {
          return Array.isArray(required) && required.includes(tagName);
        }
        function addMappings(sch, i) {
          if (sch.const) {
            addMapping(sch.const, i);
          } else if (sch.enum) {
            for (const tagValue of sch.enum) {
              addMapping(tagValue, i);
            }
          } else {
            throw new Error(`discriminator: "properties/${tagName}" must have "const" or "enum"`);
          }
        }
        function addMapping(tagValue, i) {
          if (typeof tagValue != "string" || tagValue in oneOfMapping) {
            throw new Error(`discriminator: "${tagName}" values must be unique strings`);
          }
          oneOfMapping[tagValue] = i;
        }
      }
    }
  };
  exports.default = def;
});

// ../../node_modules/ajv/dist/refs/json-schema-2020-12/schema.json
var require_schema = __commonJS(function(exports, module) {
  module.exports = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://json-schema.org/draft/2020-12/schema",
    $vocabulary: {
      "https://json-schema.org/draft/2020-12/vocab/core": true,
      "https://json-schema.org/draft/2020-12/vocab/applicator": true,
      "https://json-schema.org/draft/2020-12/vocab/unevaluated": true,
      "https://json-schema.org/draft/2020-12/vocab/validation": true,
      "https://json-schema.org/draft/2020-12/vocab/meta-data": true,
      "https://json-schema.org/draft/2020-12/vocab/format-annotation": true,
      "https://json-schema.org/draft/2020-12/vocab/content": true
    },
    $dynamicAnchor: "meta",
    title: "Core and Validation specifications meta-schema",
    allOf: [
      { $ref: "meta/core" },
      { $ref: "meta/applicator" },
      { $ref: "meta/unevaluated" },
      { $ref: "meta/validation" },
      { $ref: "meta/meta-data" },
      { $ref: "meta/format-annotation" },
      { $ref: "meta/content" }
    ],
    type: ["object", "boolean"],
    $comment: "This meta-schema also defines keywords that have appeared in previous drafts in order to prevent incompatible extensions as they remain in common use.",
    properties: {
      definitions: {
        $comment: '"definitions" has been replaced by "$defs".',
        type: "object",
        additionalProperties: { $dynamicRef: "#meta" },
        deprecated: true,
        default: {}
      },
      dependencies: {
        $comment: '"dependencies" has been split and replaced by "dependentSchemas" and "dependentRequired" in order to serve their differing semantics.',
        type: "object",
        additionalProperties: {
          anyOf: [{ $dynamicRef: "#meta" }, { $ref: "meta/validation#/$defs/stringArray" }]
        },
        deprecated: true,
        default: {}
      },
      $recursiveAnchor: {
        $comment: '"$recursiveAnchor" has been replaced by "$dynamicAnchor".',
        $ref: "meta/core#/$defs/anchorString",
        deprecated: true
      },
      $recursiveRef: {
        $comment: '"$recursiveRef" has been replaced by "$dynamicRef".',
        $ref: "meta/core#/$defs/uriReferenceString",
        deprecated: true
      }
    }
  };
});

// ../../node_modules/ajv/dist/refs/json-schema-2020-12/meta/applicator.json
var require_applicator2 = __commonJS(function(exports, module) {
  module.exports = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://json-schema.org/draft/2020-12/meta/applicator",
    $vocabulary: {
      "https://json-schema.org/draft/2020-12/vocab/applicator": true
    },
    $dynamicAnchor: "meta",
    title: "Applicator vocabulary meta-schema",
    type: ["object", "boolean"],
    properties: {
      prefixItems: { $ref: "#/$defs/schemaArray" },
      items: { $dynamicRef: "#meta" },
      contains: { $dynamicRef: "#meta" },
      additionalProperties: { $dynamicRef: "#meta" },
      properties: {
        type: "object",
        additionalProperties: { $dynamicRef: "#meta" },
        default: {}
      },
      patternProperties: {
        type: "object",
        additionalProperties: { $dynamicRef: "#meta" },
        propertyNames: { format: "regex" },
        default: {}
      },
      dependentSchemas: {
        type: "object",
        additionalProperties: { $dynamicRef: "#meta" },
        default: {}
      },
      propertyNames: { $dynamicRef: "#meta" },
      if: { $dynamicRef: "#meta" },
      then: { $dynamicRef: "#meta" },
      else: { $dynamicRef: "#meta" },
      allOf: { $ref: "#/$defs/schemaArray" },
      anyOf: { $ref: "#/$defs/schemaArray" },
      oneOf: { $ref: "#/$defs/schemaArray" },
      not: { $dynamicRef: "#meta" }
    },
    $defs: {
      schemaArray: {
        type: "array",
        minItems: 1,
        items: { $dynamicRef: "#meta" }
      }
    }
  };
});

// ../../node_modules/ajv/dist/refs/json-schema-2020-12/meta/unevaluated.json
var require_unevaluated2 = __commonJS(function(exports, module) {
  module.exports = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://json-schema.org/draft/2020-12/meta/unevaluated",
    $vocabulary: {
      "https://json-schema.org/draft/2020-12/vocab/unevaluated": true
    },
    $dynamicAnchor: "meta",
    title: "Unevaluated applicator vocabulary meta-schema",
    type: ["object", "boolean"],
    properties: {
      unevaluatedItems: { $dynamicRef: "#meta" },
      unevaluatedProperties: { $dynamicRef: "#meta" }
    }
  };
});

// ../../node_modules/ajv/dist/refs/json-schema-2020-12/meta/content.json
var require_content = __commonJS(function(exports, module) {
  module.exports = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://json-schema.org/draft/2020-12/meta/content",
    $vocabulary: {
      "https://json-schema.org/draft/2020-12/vocab/content": true
    },
    $dynamicAnchor: "meta",
    title: "Content vocabulary meta-schema",
    type: ["object", "boolean"],
    properties: {
      contentEncoding: { type: "string" },
      contentMediaType: { type: "string" },
      contentSchema: { $dynamicRef: "#meta" }
    }
  };
});

// ../../node_modules/ajv/dist/refs/json-schema-2020-12/meta/core.json
var require_core3 = __commonJS(function(exports, module) {
  module.exports = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://json-schema.org/draft/2020-12/meta/core",
    $vocabulary: {
      "https://json-schema.org/draft/2020-12/vocab/core": true
    },
    $dynamicAnchor: "meta",
    title: "Core vocabulary meta-schema",
    type: ["object", "boolean"],
    properties: {
      $id: {
        $ref: "#/$defs/uriReferenceString",
        $comment: "Non-empty fragments not allowed.",
        pattern: "^[^#]*#?$"
      },
      $schema: { $ref: "#/$defs/uriString" },
      $ref: { $ref: "#/$defs/uriReferenceString" },
      $anchor: { $ref: "#/$defs/anchorString" },
      $dynamicRef: { $ref: "#/$defs/uriReferenceString" },
      $dynamicAnchor: { $ref: "#/$defs/anchorString" },
      $vocabulary: {
        type: "object",
        propertyNames: { $ref: "#/$defs/uriString" },
        additionalProperties: {
          type: "boolean"
        }
      },
      $comment: {
        type: "string"
      },
      $defs: {
        type: "object",
        additionalProperties: { $dynamicRef: "#meta" }
      }
    },
    $defs: {
      anchorString: {
        type: "string",
        pattern: "^[A-Za-z_][-A-Za-z0-9._]*$"
      },
      uriString: {
        type: "string",
        format: "uri"
      },
      uriReferenceString: {
        type: "string",
        format: "uri-reference"
      }
    }
  };
});

// ../../node_modules/ajv/dist/refs/json-schema-2020-12/meta/format-annotation.json
var require_format_annotation = __commonJS(function(exports, module) {
  module.exports = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://json-schema.org/draft/2020-12/meta/format-annotation",
    $vocabulary: {
      "https://json-schema.org/draft/2020-12/vocab/format-annotation": true
    },
    $dynamicAnchor: "meta",
    title: "Format vocabulary meta-schema for annotation results",
    type: ["object", "boolean"],
    properties: {
      format: { type: "string" }
    }
  };
});

// ../../node_modules/ajv/dist/refs/json-schema-2020-12/meta/meta-data.json
var require_meta_data = __commonJS(function(exports, module) {
  module.exports = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://json-schema.org/draft/2020-12/meta/meta-data",
    $vocabulary: {
      "https://json-schema.org/draft/2020-12/vocab/meta-data": true
    },
    $dynamicAnchor: "meta",
    title: "Meta-data vocabulary meta-schema",
    type: ["object", "boolean"],
    properties: {
      title: {
        type: "string"
      },
      description: {
        type: "string"
      },
      default: true,
      deprecated: {
        type: "boolean",
        default: false
      },
      readOnly: {
        type: "boolean",
        default: false
      },
      writeOnly: {
        type: "boolean",
        default: false
      },
      examples: {
        type: "array",
        items: true
      }
    }
  };
});

// ../../node_modules/ajv/dist/refs/json-schema-2020-12/meta/validation.json
var require_validation2 = __commonJS(function(exports, module) {
  module.exports = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://json-schema.org/draft/2020-12/meta/validation",
    $vocabulary: {
      "https://json-schema.org/draft/2020-12/vocab/validation": true
    },
    $dynamicAnchor: "meta",
    title: "Validation vocabulary meta-schema",
    type: ["object", "boolean"],
    properties: {
      type: {
        anyOf: [
          { $ref: "#/$defs/simpleTypes" },
          {
            type: "array",
            items: { $ref: "#/$defs/simpleTypes" },
            minItems: 1,
            uniqueItems: true
          }
        ]
      },
      const: true,
      enum: {
        type: "array",
        items: true
      },
      multipleOf: {
        type: "number",
        exclusiveMinimum: 0
      },
      maximum: {
        type: "number"
      },
      exclusiveMaximum: {
        type: "number"
      },
      minimum: {
        type: "number"
      },
      exclusiveMinimum: {
        type: "number"
      },
      maxLength: { $ref: "#/$defs/nonNegativeInteger" },
      minLength: { $ref: "#/$defs/nonNegativeIntegerDefault0" },
      pattern: {
        type: "string",
        format: "regex"
      },
      maxItems: { $ref: "#/$defs/nonNegativeInteger" },
      minItems: { $ref: "#/$defs/nonNegativeIntegerDefault0" },
      uniqueItems: {
        type: "boolean",
        default: false
      },
      maxContains: { $ref: "#/$defs/nonNegativeInteger" },
      minContains: {
        $ref: "#/$defs/nonNegativeInteger",
        default: 1
      },
      maxProperties: { $ref: "#/$defs/nonNegativeInteger" },
      minProperties: { $ref: "#/$defs/nonNegativeIntegerDefault0" },
      required: { $ref: "#/$defs/stringArray" },
      dependentRequired: {
        type: "object",
        additionalProperties: {
          $ref: "#/$defs/stringArray"
        }
      }
    },
    $defs: {
      nonNegativeInteger: {
        type: "integer",
        minimum: 0
      },
      nonNegativeIntegerDefault0: {
        $ref: "#/$defs/nonNegativeInteger",
        default: 0
      },
      simpleTypes: {
        enum: ["array", "boolean", "integer", "null", "number", "object", "string"]
      },
      stringArray: {
        type: "array",
        items: { type: "string" },
        uniqueItems: true,
        default: []
      }
    }
  };
});

// ../../node_modules/ajv/dist/refs/json-schema-2020-12/index.js
var require_json_schema_2020_12 = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var metaSchema = require_schema();
  var applicator = require_applicator2();
  var unevaluated = require_unevaluated2();
  var content = require_content();
  var core = require_core3();
  var format = require_format_annotation();
  var metadata = require_meta_data();
  var validation = require_validation2();
  var META_SUPPORT_DATA = ["/properties"];
  function addMetaSchema2020($data) {
    [
      metaSchema,
      applicator,
      unevaluated,
      content,
      core,
      with$data(this, format),
      metadata,
      with$data(this, validation)
    ].forEach((sch) => this.addMetaSchema(sch, undefined, false));
    return this;
    function with$data(ajv, sch) {
      return $data ? ajv.$dataMetaSchema(sch, META_SUPPORT_DATA) : sch;
    }
  }
  exports.default = addMetaSchema2020;
});

// ../../node_modules/ajv/dist/2020.js
var require__2020 = __commonJS(function(exports, module) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.MissingRefError = exports.ValidationError = exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = exports.Ajv2020 = undefined;
  var core_1 = require_core();
  var draft2020_1 = require_draft2020();
  var discriminator_1 = require_discriminator();
  var json_schema_2020_12_1 = require_json_schema_2020_12();
  var META_SCHEMA_ID = "https://json-schema.org/draft/2020-12/schema";

  class Ajv2020 extends core_1.default {
    constructor(opts = {}) {
      super({
        ...opts,
        dynamicRef: true,
        next: true,
        unevaluated: true
      });
    }
    _addVocabularies() {
      super._addVocabularies();
      draft2020_1.default.forEach((v) => this.addVocabulary(v));
      if (this.opts.discriminator)
        this.addKeyword(discriminator_1.default);
    }
    _addDefaultMetaSchema() {
      super._addDefaultMetaSchema();
      const { $data, meta } = this.opts;
      if (!meta)
        return;
      json_schema_2020_12_1.default.call(this, $data);
      this.refs["http://json-schema.org/schema"] = META_SCHEMA_ID;
    }
    defaultMeta() {
      return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(META_SCHEMA_ID) ? META_SCHEMA_ID : undefined);
    }
  }
  exports.Ajv2020 = Ajv2020;
  module.exports = exports = Ajv2020;
  module.exports.Ajv2020 = Ajv2020;
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.default = Ajv2020;
  var validate_1 = require_validate();
  Object.defineProperty(exports, "KeywordCxt", { enumerable: true, get: function() {
    return validate_1.KeywordCxt;
  } });
  var codegen_1 = require_codegen();
  Object.defineProperty(exports, "_", { enumerable: true, get: function() {
    return codegen_1._;
  } });
  Object.defineProperty(exports, "str", { enumerable: true, get: function() {
    return codegen_1.str;
  } });
  Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
    return codegen_1.stringify;
  } });
  Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
    return codegen_1.nil;
  } });
  Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
    return codegen_1.Name;
  } });
  Object.defineProperty(exports, "CodeGen", { enumerable: true, get: function() {
    return codegen_1.CodeGen;
  } });
  var validation_error_1 = require_validation_error();
  Object.defineProperty(exports, "ValidationError", { enumerable: true, get: function() {
    return validation_error_1.default;
  } });
  var ref_error_1 = require_ref_error();
  Object.defineProperty(exports, "MissingRefError", { enumerable: true, get: function() {
    return ref_error_1.default;
  } });
});

// ../../node_modules/ajv-formats/dist/formats.js
var require_formats = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.formatNames = exports.fastFormats = exports.fullFormats = undefined;
  function fmtDef(validate, compare) {
    return { validate, compare };
  }
  exports.fullFormats = {
    date: fmtDef(date, compareDate),
    time: fmtDef(getTime(true), compareTime),
    "date-time": fmtDef(getDateTime(true), compareDateTime),
    "iso-time": fmtDef(getTime(), compareIsoTime),
    "iso-date-time": fmtDef(getDateTime(), compareIsoDateTime),
    duration: /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/,
    uri,
    "uri-reference": /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i,
    "uri-template": /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
    url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu,
    email: /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i,
    hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i,
    ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
    ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i,
    regex,
    uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
    "json-pointer": /^(?:\/(?:[^~/]|~0|~1)*)*$/,
    "json-pointer-uri-fragment": /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
    "relative-json-pointer": /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
    byte,
    int32: { type: "number", validate: validateInt32 },
    int64: { type: "number", validate: validateInt64 },
    float: { type: "number", validate: validateNumber },
    double: { type: "number", validate: validateNumber },
    password: true,
    binary: true
  };
  exports.fastFormats = {
    ...exports.fullFormats,
    date: fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d$/, compareDate),
    time: fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareTime),
    "date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareDateTime),
    "iso-time": fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoTime),
    "iso-date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d[t\s](?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoDateTime),
    uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
    "uri-reference": /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
    email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
  };
  exports.formatNames = Object.keys(exports.fullFormats);
  function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }
  var DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
  var DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function date(str) {
    const matches = DATE.exec(str);
    if (!matches)
      return false;
    const year = +matches[1];
    const month = +matches[2];
    const day = +matches[3];
    return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && isLeapYear(year) ? 29 : DAYS[month]);
  }
  function compareDate(d1, d2) {
    if (!(d1 && d2))
      return;
    if (d1 > d2)
      return 1;
    if (d1 < d2)
      return -1;
    return 0;
  }
  var TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
  function getTime(strictTimeZone) {
    return function time(str) {
      const matches = TIME.exec(str);
      if (!matches)
        return false;
      const hr = +matches[1];
      const min = +matches[2];
      const sec = +matches[3];
      const tz = matches[4];
      const tzSign = matches[5] === "-" ? -1 : 1;
      const tzH = +(matches[6] || 0);
      const tzM = +(matches[7] || 0);
      if (tzH > 23 || tzM > 59 || strictTimeZone && !tz)
        return false;
      if (hr <= 23 && min <= 59 && sec < 60)
        return true;
      const utcMin = min - tzM * tzSign;
      const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
      return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
    };
  }
  function compareTime(s1, s2) {
    if (!(s1 && s2))
      return;
    const t1 = new Date("2020-01-01T" + s1).valueOf();
    const t2 = new Date("2020-01-01T" + s2).valueOf();
    if (!(t1 && t2))
      return;
    return t1 - t2;
  }
  function compareIsoTime(t1, t2) {
    if (!(t1 && t2))
      return;
    const a1 = TIME.exec(t1);
    const a2 = TIME.exec(t2);
    if (!(a1 && a2))
      return;
    t1 = a1[1] + a1[2] + a1[3];
    t2 = a2[1] + a2[2] + a2[3];
    if (t1 > t2)
      return 1;
    if (t1 < t2)
      return -1;
    return 0;
  }
  var DATE_TIME_SEPARATOR = /t|\s/i;
  function getDateTime(strictTimeZone) {
    const time = getTime(strictTimeZone);
    return function date_time(str) {
      const dateTime = str.split(DATE_TIME_SEPARATOR);
      return dateTime.length === 2 && date(dateTime[0]) && time(dateTime[1]);
    };
  }
  function compareDateTime(dt1, dt2) {
    if (!(dt1 && dt2))
      return;
    const d1 = new Date(dt1).valueOf();
    const d2 = new Date(dt2).valueOf();
    if (!(d1 && d2))
      return;
    return d1 - d2;
  }
  function compareIsoDateTime(dt1, dt2) {
    if (!(dt1 && dt2))
      return;
    const [d1, t1] = dt1.split(DATE_TIME_SEPARATOR);
    const [d2, t2] = dt2.split(DATE_TIME_SEPARATOR);
    const res = compareDate(d1, d2);
    if (res === undefined)
      return;
    return res || compareTime(t1, t2);
  }
  var NOT_URI_FRAGMENT = /\/|:/;
  var URI = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
  function uri(str) {
    return NOT_URI_FRAGMENT.test(str) && URI.test(str);
  }
  var BYTE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/gm;
  function byte(str) {
    BYTE.lastIndex = 0;
    return BYTE.test(str);
  }
  var MIN_INT32 = -(2 ** 31);
  var MAX_INT32 = 2 ** 31 - 1;
  function validateInt32(value) {
    return Number.isInteger(value) && value <= MAX_INT32 && value >= MIN_INT32;
  }
  function validateInt64(value) {
    return Number.isInteger(value);
  }
  function validateNumber() {
    return true;
  }
  var Z_ANCHOR = /[^\\]\\Z/;
  function regex(str) {
    if (Z_ANCHOR.test(str))
      return false;
    try {
      new RegExp(str);
      return true;
    } catch (e) {
      return false;
    }
  }
});

// ../../node_modules/ajv/dist/vocabularies/draft7.js
var require_draft7 = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var core_1 = require_core2();
  var validation_1 = require_validation();
  var applicator_1 = require_applicator();
  var format_1 = require_format2();
  var metadata_1 = require_metadata();
  var draft7Vocabularies = [
    core_1.default,
    validation_1.default,
    (0, applicator_1.default)(),
    format_1.default,
    metadata_1.metadataVocabulary,
    metadata_1.contentVocabulary
  ];
  exports.default = draft7Vocabularies;
});

// ../../node_modules/ajv/dist/refs/json-schema-draft-07.json
var require_json_schema_draft_07 = __commonJS(function(exports, module) {
  module.exports = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "http://json-schema.org/draft-07/schema#",
    title: "Core schema meta-schema",
    definitions: {
      schemaArray: {
        type: "array",
        minItems: 1,
        items: { $ref: "#" }
      },
      nonNegativeInteger: {
        type: "integer",
        minimum: 0
      },
      nonNegativeIntegerDefault0: {
        allOf: [{ $ref: "#/definitions/nonNegativeInteger" }, { default: 0 }]
      },
      simpleTypes: {
        enum: ["array", "boolean", "integer", "null", "number", "object", "string"]
      },
      stringArray: {
        type: "array",
        items: { type: "string" },
        uniqueItems: true,
        default: []
      }
    },
    type: ["object", "boolean"],
    properties: {
      $id: {
        type: "string",
        format: "uri-reference"
      },
      $schema: {
        type: "string",
        format: "uri"
      },
      $ref: {
        type: "string",
        format: "uri-reference"
      },
      $comment: {
        type: "string"
      },
      title: {
        type: "string"
      },
      description: {
        type: "string"
      },
      default: true,
      readOnly: {
        type: "boolean",
        default: false
      },
      examples: {
        type: "array",
        items: true
      },
      multipleOf: {
        type: "number",
        exclusiveMinimum: 0
      },
      maximum: {
        type: "number"
      },
      exclusiveMaximum: {
        type: "number"
      },
      minimum: {
        type: "number"
      },
      exclusiveMinimum: {
        type: "number"
      },
      maxLength: { $ref: "#/definitions/nonNegativeInteger" },
      minLength: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
      pattern: {
        type: "string",
        format: "regex"
      },
      additionalItems: { $ref: "#" },
      items: {
        anyOf: [{ $ref: "#" }, { $ref: "#/definitions/schemaArray" }],
        default: true
      },
      maxItems: { $ref: "#/definitions/nonNegativeInteger" },
      minItems: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
      uniqueItems: {
        type: "boolean",
        default: false
      },
      contains: { $ref: "#" },
      maxProperties: { $ref: "#/definitions/nonNegativeInteger" },
      minProperties: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
      required: { $ref: "#/definitions/stringArray" },
      additionalProperties: { $ref: "#" },
      definitions: {
        type: "object",
        additionalProperties: { $ref: "#" },
        default: {}
      },
      properties: {
        type: "object",
        additionalProperties: { $ref: "#" },
        default: {}
      },
      patternProperties: {
        type: "object",
        additionalProperties: { $ref: "#" },
        propertyNames: { format: "regex" },
        default: {}
      },
      dependencies: {
        type: "object",
        additionalProperties: {
          anyOf: [{ $ref: "#" }, { $ref: "#/definitions/stringArray" }]
        }
      },
      propertyNames: { $ref: "#" },
      const: true,
      enum: {
        type: "array",
        items: true,
        minItems: 1,
        uniqueItems: true
      },
      type: {
        anyOf: [
          { $ref: "#/definitions/simpleTypes" },
          {
            type: "array",
            items: { $ref: "#/definitions/simpleTypes" },
            minItems: 1,
            uniqueItems: true
          }
        ]
      },
      format: { type: "string" },
      contentMediaType: { type: "string" },
      contentEncoding: { type: "string" },
      if: { $ref: "#" },
      then: { $ref: "#" },
      else: { $ref: "#" },
      allOf: { $ref: "#/definitions/schemaArray" },
      anyOf: { $ref: "#/definitions/schemaArray" },
      oneOf: { $ref: "#/definitions/schemaArray" },
      not: { $ref: "#" }
    },
    default: true
  };
});

// ../../node_modules/ajv/dist/ajv.js
var require_ajv = __commonJS(function(exports, module) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.MissingRefError = exports.ValidationError = exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = exports.Ajv = undefined;
  var core_1 = require_core();
  var draft7_1 = require_draft7();
  var discriminator_1 = require_discriminator();
  var draft7MetaSchema = require_json_schema_draft_07();
  var META_SUPPORT_DATA = ["/properties"];
  var META_SCHEMA_ID = "http://json-schema.org/draft-07/schema";

  class Ajv extends core_1.default {
    _addVocabularies() {
      super._addVocabularies();
      draft7_1.default.forEach((v) => this.addVocabulary(v));
      if (this.opts.discriminator)
        this.addKeyword(discriminator_1.default);
    }
    _addDefaultMetaSchema() {
      super._addDefaultMetaSchema();
      if (!this.opts.meta)
        return;
      const metaSchema = this.opts.$data ? this.$dataMetaSchema(draft7MetaSchema, META_SUPPORT_DATA) : draft7MetaSchema;
      this.addMetaSchema(metaSchema, META_SCHEMA_ID, false);
      this.refs["http://json-schema.org/schema"] = META_SCHEMA_ID;
    }
    defaultMeta() {
      return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(META_SCHEMA_ID) ? META_SCHEMA_ID : undefined);
    }
  }
  exports.Ajv = Ajv;
  module.exports = exports = Ajv;
  module.exports.Ajv = Ajv;
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.default = Ajv;
  var validate_1 = require_validate();
  Object.defineProperty(exports, "KeywordCxt", { enumerable: true, get: function() {
    return validate_1.KeywordCxt;
  } });
  var codegen_1 = require_codegen();
  Object.defineProperty(exports, "_", { enumerable: true, get: function() {
    return codegen_1._;
  } });
  Object.defineProperty(exports, "str", { enumerable: true, get: function() {
    return codegen_1.str;
  } });
  Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
    return codegen_1.stringify;
  } });
  Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
    return codegen_1.nil;
  } });
  Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
    return codegen_1.Name;
  } });
  Object.defineProperty(exports, "CodeGen", { enumerable: true, get: function() {
    return codegen_1.CodeGen;
  } });
  var validation_error_1 = require_validation_error();
  Object.defineProperty(exports, "ValidationError", { enumerable: true, get: function() {
    return validation_error_1.default;
  } });
  var ref_error_1 = require_ref_error();
  Object.defineProperty(exports, "MissingRefError", { enumerable: true, get: function() {
    return ref_error_1.default;
  } });
});

// ../../node_modules/ajv-formats/dist/limit.js
var require_limit = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.formatLimitDefinition = undefined;
  var ajv_1 = require_ajv();
  var codegen_1 = require_codegen();
  var ops = codegen_1.operators;
  var KWDs = {
    formatMaximum: { okStr: "<=", ok: ops.LTE, fail: ops.GT },
    formatMinimum: { okStr: ">=", ok: ops.GTE, fail: ops.LT },
    formatExclusiveMaximum: { okStr: "<", ok: ops.LT, fail: ops.GTE },
    formatExclusiveMinimum: { okStr: ">", ok: ops.GT, fail: ops.LTE }
  };
  var error = {
    message: ({ keyword, schemaCode }) => (0, codegen_1.str)`should be ${KWDs[keyword].okStr} ${schemaCode}`,
    params: ({ keyword, schemaCode }) => (0, codegen_1._)`{comparison: ${KWDs[keyword].okStr}, limit: ${schemaCode}}`
  };
  exports.formatLimitDefinition = {
    keyword: Object.keys(KWDs),
    type: "string",
    schemaType: "string",
    $data: true,
    error,
    code(cxt) {
      const { gen, data, schemaCode, keyword, it } = cxt;
      const { opts, self } = it;
      if (!opts.validateFormats)
        return;
      const fCxt = new ajv_1.KeywordCxt(it, self.RULES.all.format.definition, "format");
      if (fCxt.$data)
        validate$DataFormat();
      else
        validateFormat();
      function validate$DataFormat() {
        const fmts = gen.scopeValue("formats", {
          ref: self.formats,
          code: opts.code.formats
        });
        const fmt = gen.const("fmt", (0, codegen_1._)`${fmts}[${fCxt.schemaCode}]`);
        cxt.fail$data((0, codegen_1.or)((0, codegen_1._)`typeof ${fmt} != "object"`, (0, codegen_1._)`${fmt} instanceof RegExp`, (0, codegen_1._)`typeof ${fmt}.compare != "function"`, compareCode(fmt)));
      }
      function validateFormat() {
        const format = fCxt.schema;
        const fmtDef = self.formats[format];
        if (!fmtDef || fmtDef === true)
          return;
        if (typeof fmtDef != "object" || fmtDef instanceof RegExp || typeof fmtDef.compare != "function") {
          throw new Error(`"${keyword}": format "${format}" does not define "compare" function`);
        }
        const fmt = gen.scopeValue("formats", {
          key: format,
          ref: fmtDef,
          code: opts.code.formats ? (0, codegen_1._)`${opts.code.formats}${(0, codegen_1.getProperty)(format)}` : undefined
        });
        cxt.fail$data(compareCode(fmt));
      }
      function compareCode(fmt) {
        return (0, codegen_1._)`${fmt}.compare(${data}, ${schemaCode}) ${KWDs[keyword].fail} 0`;
      }
    },
    dependencies: ["format"]
  };
  var formatLimitPlugin = (ajv) => {
    ajv.addKeyword(exports.formatLimitDefinition);
    return ajv;
  };
  exports.default = formatLimitPlugin;
});

// ../../node_modules/ajv-formats/dist/index.js
var require_dist = __commonJS(function(exports, module) {
  Object.defineProperty(exports, "__esModule", { value: true });
  var formats_1 = require_formats();
  var limit_1 = require_limit();
  var codegen_1 = require_codegen();
  var fullName = new codegen_1.Name("fullFormats");
  var fastName = new codegen_1.Name("fastFormats");
  var formatsPlugin = (ajv, opts = { keywords: true }) => {
    if (Array.isArray(opts)) {
      addFormats(ajv, opts, formats_1.fullFormats, fullName);
      return ajv;
    }
    const [formats, exportName] = opts.mode === "fast" ? [formats_1.fastFormats, fastName] : [formats_1.fullFormats, fullName];
    const list = opts.formats || formats_1.formatNames;
    addFormats(ajv, list, formats, exportName);
    if (opts.keywords)
      (0, limit_1.default)(ajv);
    return ajv;
  };
  formatsPlugin.get = (name, mode = "full") => {
    const formats = mode === "fast" ? formats_1.fastFormats : formats_1.fullFormats;
    const f = formats[name];
    if (!f)
      throw new Error(`Unknown format "${name}"`);
    return f;
  };
  function addFormats(ajv, list, fs, exportName) {
    var _a;
    var _b;
    (_a = (_b = ajv.opts.code).formats) !== null && _a !== undefined || (_b.formats = (0, codegen_1._)`require("ajv-formats/dist/formats").${exportName}`);
    for (const f of list)
      ajv.addFormat(f, fs[f]);
  }
  module.exports = exports = formatsPlugin;
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.default = formatsPlugin;
});

// src/assets.ts
import { existsSync as existsSync4, mkdirSync, readFileSync as readFileSync3 } from "fs";
import { homedir } from "os";
import { dirname, join as join5, resolve as resolve4 } from "path";

// src/commands.ts
import { parseArgs } from "util";

// src/catalog.ts
import { readFileSync } from "fs";
import { join as join3, relative as relative2 } from "path";

// src/manifest-contract.ts
import { existsSync, statSync } from "fs";
import { isAbsolute, join, relative, resolve, sep } from "path";

// src/text.ts
var FOLD = { \u{df}: "ss", \u{1e9e}: "ss", \u{3c2}: "\u03C3", \u{17f}: "s", \u{fb05}: "st", \u{fb06}: "st", \u{130}: "i\u0307" };
function casefold(text) {
  return text.toLowerCase().replace(/[\u00DF\u1E9E\u03C2\u017F\uFB05\uFB06\u0130]/g, (c) => FOLD[c] ?? c);
}
function normalize(text) {
  return casefold(text.normalize("NFKC")).replaceAll("\u2019", "'");
}
var TOKEN = /\p{Nd}+(?:[x\u00D7]\p{Nd}+)+|[\p{L}\p{N}_]+'?|[+\u2212=]/gu;
function tokens(text) {
  return normalize(text).match(TOKEN) ?? [];
}
var WORD = "[\\p{L}\\p{N}_]";
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// src/manifest-contract.ts
var KNOWLEDGE_KINDS = new Set([
  "object-archetype",
  "material-profile",
  "physical-behavior",
  "tool-adapter",
  "inspection-pattern",
  "validation-profile",
  "style-profile",
  "theme-profile",
  "presentation-profile",
  "composition-profile",
  "motion-profile",
  "interaction-profile",
  "reasoning-rule",
  "domain-validation",
  "geometry-profile",
  "lighting-profile",
  "output-profile",
  "blueprint"
]);
var COLLECTIONS = new Set(["recipes", "knowledge", "all"]);
var SEARCH_FIELDS = new Set([
  "title.en",
  "aliases.en",
  "summary",
  "objective",
  "tags",
  "subject_terms",
  "intent_signals",
  "example_prompts",
  "applies_when",
  "defaults.values.feeling"
]);
var MAX_QUERY_ALIASES = 200;
var finite = (v) => typeof v === "number" && Number.isFinite(v);
function byParts(a, b) {
  const pa = a.split("/"), pb = b.split("/");
  for (let i = 0;i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] !== pb[i])
      return pa[i] < pb[i] ? -1 : 1;
  }
  return pa.length - pb.length;
}
function validateManifest(manifest, data) {
  const m = manifest;
  if (!m || typeof m !== "object" || m.schema_version !== 1)
    throw new Error("Unsupported manifest schema");
  const layout = m.layout_version ?? 1;
  if (!Number.isInteger(layout) || ![1, 2].includes(layout))
    throw new Error("Unsupported catalog layout version");
  const collections = m.collections;
  const names = collections && typeof collections === "object" ? Object.keys(collections) : [];
  const allowed = new Set(["recipes", "sources", "directions", "knowledge"]);
  if (!collections || !["recipes", "sources", "directions"].every((n) => names.includes(n)) || names.some((n) => !allowed.has(n)))
    throw new Error("Manifest requires recipes, sources and directions collections");
  const paths = {};
  const root = resolve(data);
  for (const [name, pattern] of Object.entries(collections)) {
    if (typeof pattern !== "string" || pattern.includes("\\") || pattern.includes(":") || isAbsolute(pattern) || pattern.split("/").includes(".."))
      throw new Error(`Unsafe collection path: ${name}`);
    const selected = existsSync(root) ? [...new Bun.Glob(pattern).scanSync({ cwd: root, onlyFiles: false })].map((p) => p.replaceAll("\\", "/")).sort(byParts) : [];
    if (selected.length === 0 || !["recipes", "knowledge"].includes(name) && selected.length !== 1)
      throw new Error(`Missing or ambiguous collection: ${name}`);
    paths[name] = selected.map((rel) => {
      const abs = join(root, rel);
      const inside = !relative(root, resolve(abs)).startsWith("..");
      if (!statSync(abs).isFile() || !rel.endsWith(".json") || !inside)
        throw new Error(`Invalid collection member: ${name}`);
      return abs;
    });
  }
  const cfg = m.search ?? {};
  if (cfg.algorithm !== "weighted-field-bm25" && cfg.algorithm !== "overlap")
    throw new Error("Unsupported search algorithm");
  if (!Number.isInteger(cfg.version) || cfg.version < 1)
    throw new Error("Search version must be a positive integer");
  if (cfg.tokenizer !== "unicode-notation-v1")
    throw new Error("Unsupported tokenizer");
  const fields = cfg.fields;
  if (!fields || typeof fields !== "object" || !Object.keys(fields).length || Object.keys(fields).some((f) => !SEARCH_FIELDS.has(f)))
    throw new Error("Invalid positive search fields");
  for (const [field, boost] of Object.entries(fields)) {
    if (!finite(boost) || boost <= 0)
      throw new Error(`Invalid boost: ${field}`);
  }
  for (const key of ["k1", "b"]) {
    if (!finite(cfg[key]))
      throw new Error(`Invalid parameter: ${key}`);
  }
  if (cfg.k1 <= 0 || !(cfg.b >= 0 && cfg.b <= 1))
    throw new Error("BM25 parameters out of range");
  validateQueryAliases(cfg.query_aliases ?? {});
  return paths;
}
function validateQueryAliases(aliases) {
  if (!aliases || typeof aliases !== "object" || Array.isArray(aliases))
    throw new Error("query_aliases must be an object");
  const entries = Object.entries(aliases);
  if (entries.length > MAX_QUERY_ALIASES)
    throw new Error(`query_aliases exceeds ${MAX_QUERY_ALIASES} entries`);
  for (const [phrase, expansion] of entries) {
    if (!phrase.trim() || casefold(phrase) !== phrase)
      throw new Error(`query_aliases key must be a nonempty casefolded string: '${phrase}'`);
    if (!Array.isArray(expansion) || !expansion.length)
      throw new Error(`query_aliases value must be a nonempty list: ${phrase}`);
    for (const term of expansion) {
      if (typeof term !== "string" || !term.trim())
        throw new Error(`query_aliases term must be a nonempty string: ${phrase}`);
    }
    if (expansion.includes(phrase))
      throw new Error(`query_aliases key repeats itself in its expansion: ${phrase}`);
  }
  return aliases;
}
function recordPath(record, collection) {
  const prefix = collection === "recipes" ? "recipe" : "knowledge";
  const rid = record.id;
  if (typeof rid !== "string" || !new RegExp(`^${prefix}\\.[a-z0-9]+(?:-[a-z0-9]+)*$`).test(rid))
    throw new Error(`Invalid ${prefix} ID: ${String(rid ?? "")}`);
  const slug = rid.split(".").slice(1).join(".");
  if (collection === "knowledge") {
    const kind = record.knowledge_kind;
    if (typeof kind !== "string" || !KNOWLEDGE_KINDS.has(kind))
      throw new Error(`${rid}: invalid knowledge_kind`);
    return `knowledge/${kind}/${slug}.json`;
  }
  return `recipes/${slug}.json`;
}
function recordFile(value, relativePath, collection, layoutVersion = 1) {
  if (layoutVersion === 2) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`${relativePath}: layout 2 requires one record object per file`);
    const expected = recordPath(value, collection);
    if (relativePath !== expected)
      throw new Error(`${relativePath}: expected record path ${expected}`);
    return [value];
  }
  const rows = Array.isArray(value) ? value : [value];
  if (!rows.every((r) => r && typeof r === "object" && !Array.isArray(r)))
    throw new Error(`${relativePath}: record object or array of objects required`);
  return rows;
}
var toPosix = (p) => p.split(sep).join("/");

// src/paths.ts
import { existsSync as existsSync2 } from "fs";
import { join as join2, resolve as resolve2 } from "path";
var HERE_PARENT = resolve2(import.meta.dir, "..");
var bundled = existsSync2(join2(HERE_PARENT, "data/manifest.json"));
function skillRoot() {
  if (Bun.env.VIZ3D_SKILL_ROOT)
    return resolve2(Bun.env.VIZ3D_SKILL_ROOT);
  return bundled ? HERE_PARENT : join2(HERE_PARENT, "plugin/skills/3dviz-pro-max");
}
function runtimeDir() {
  return join2(HERE_PARENT, "runtime");
}
function studiesDir() {
  const dir = join2(HERE_PARENT, "studies");
  return existsSync2(join2(dir, "index.html")) ? dir : null;
}

// src/pyjson.ts
class PyFloat {
  value;
  constructor(value) {
    this.value = value;
  }
}
function pyFloatRepr(x) {
  if (Number.isNaN(x))
    return "NaN";
  if (!Number.isFinite(x))
    return x > 0 ? "Infinity" : "-Infinity";
  if (x === 0)
    return Object.is(x, -0) ? "-0.0" : "0.0";
  const sign = x < 0 ? "-" : "";
  const [mantissa, exponent] = Math.abs(x).toExponential().split("e");
  const digits = mantissa.replace(".", "");
  const decpt = Number(exponent) + 1;
  if (decpt > -4 && decpt <= 16) {
    if (decpt <= 0)
      return `${sign}0.${"0".repeat(-decpt)}${digits}`;
    if (decpt >= digits.length)
      return `${sign}${digits}${"0".repeat(decpt - digits.length)}.0`;
    return `${sign}${digits.slice(0, decpt)}.${digits.slice(decpt)}`;
  }
  const e = decpt - 1;
  const body = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
  return `${sign}${body}e${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
}
function parseLossless(text) {
  let i = 0;
  const fail = (what) => {
    throw new SyntaxError(`${what} at offset ${i}`);
  };
  const ws = () => {
    while (i < text.length && ` 	
\r`.includes(text[i]))
      i++;
  };
  const value = () => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      const out = {};
      ws();
      if (text[i] === "}")
        return i++, out;
      for (;; ) {
        ws();
        if (text[i] !== '"')
          fail("expected key");
        const key = string();
        ws();
        if (text[i++] !== ":")
          fail("expected :");
        out[key] = value();
        ws();
        if (text[i] === ",")
          i++;
        else if (text[i] === "}")
          return i++, out;
        else
          fail("expected , or }");
      }
    }
    if (c === "[") {
      i++;
      const out = [];
      ws();
      if (text[i] === "]")
        return i++, out;
      for (;; ) {
        out.push(value());
        ws();
        if (text[i] === ",")
          i++;
        else if (text[i] === "]")
          return i++, out;
        else
          fail("expected , or ]");
      }
    }
    if (c === '"')
      return string();
    if (text.startsWith("true", i))
      return i += 4, true;
    if (text.startsWith("false", i))
      return i += 5, false;
    if (text.startsWith("null", i))
      return i += 4, null;
    const match = /^-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 64));
    if (!match)
      return fail("unexpected token");
    i += match[0].length;
    if (match[1] || match[2])
      return new PyFloat(Number(match[0]));
    const n = Number(match[0]);
    return Number.isSafeInteger(n) ? Object.is(n, -0) ? 0 : n : BigInt(match[0]);
  };
  const string = () => {
    const start = i;
    i++;
    while (i < text.length && text[i] !== '"')
      i += text[i] === "\\" ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i));
  };
  const out = value();
  ws();
  if (i !== text.length)
    fail("trailing data");
  return out;
}
function plain(value) {
  if (value instanceof PyFloat)
    return value.value;
  if (typeof value === "bigint")
    return Number(value);
  if (Array.isArray(value))
    return value.map(plain);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value))
      out[k] = plain(v);
    return out;
  }
  return value;
}
function quote(s, ensureAscii) {
  const json = JSON.stringify(s);
  if (!ensureAscii)
    return json;
  return json.replace(/[\u0080-\uFFFF]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
function pyDumps(value, options = {}) {
  const { sortKeys = false, ensureAscii = true, indent } = options;
  const [item, kv] = options.separators ?? (indent === undefined ? [", ", ": "] : [",", ": "]);
  const walk = (v, depth) => {
    if (v === null || v === undefined)
      return "null";
    if (v === true)
      return "true";
    if (v === false)
      return "false";
    if (v instanceof PyFloat)
      return pyFloatRepr(v.value);
    if (typeof v === "bigint")
      return v.toString();
    if (typeof v === "number")
      return Number.isInteger(v) ? String(Object.is(v, -0) ? 0 : v) : pyFloatRepr(v);
    if (typeof v === "string")
      return quote(v, ensureAscii);
    const pad = indent === undefined ? "" : `
${" ".repeat(indent * (depth + 1))}`;
    const end = indent === undefined ? "" : `
${" ".repeat(indent * depth)}`;
    if (Array.isArray(v)) {
      if (v.length === 0)
        return "[]";
      return `[${pad}${v.map((x) => walk(x, depth + 1)).join(`${item}${pad}`)}${end}]`;
    }
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    if (sortKeys)
      entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    if (entries.length === 0)
      return "{}";
    return `{${pad}${entries.map(([k, x]) => `${quote(k, ensureAscii)}${kv}${walk(x, depth + 1)}`).join(`${item}${pad}`)}${end}}`;
  };
  return walk(value, 0);
}
function canonical(value) {
  return pyDumps(value, { sortKeys: true, ensureAscii: false, separators: [",", ":"] });
}
function sha256(text) {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

// src/catalog.ts
var LOSSLESS = new WeakMap;
function lossless(value) {
  const found = LOSSLESS.get(value);
  if (found === undefined)
    throw new Error("not a catalog object");
  return found;
}
function readJson(path) {
  const exact = parseLossless(readFileSync(path, "utf8"));
  return { value: plain(exact), exact };
}
var cache = new Map;
function loadCatalog(root = skillRoot(), collection = "recipes") {
  if (!COLLECTIONS.has(collection))
    throw new Error("Unknown collection");
  const key = `${root}\x00${collection}`;
  const hit = cache.get(key);
  if (hit)
    return hit;
  const data = join3(root, "data");
  const manifestJson = readJson(join3(data, "manifest.json"));
  const manifest = manifestJson.value;
  LOSSLESS.set(manifest, manifestJson.exact);
  const paths = validateManifest(manifest, data);
  const records = [];
  const selected = collection === "all" ? ["recipes", "knowledge"] : [collection];
  for (const name of selected) {
    for (const path of paths[name] ?? []) {
      const { value, exact } = readJson(path);
      const rel = toPosix(relative2(data, path));
      const rows = recordFile(value, rel, name, manifest.layout_version ?? 1);
      const exactRows = recordFile(exact, rel, name, manifest.layout_version ?? 1);
      rows.forEach((row, index) => {
        const _path = toPosix(relative2(root, path));
        const record = { ...row, _path };
        LOSSLESS.set(record, { ...exactRows[index], _path });
        records.push(record);
      });
    }
  }
  const ids = records.map((r) => r.id);
  if (new Set(ids).size !== ids.length)
    throw new Error("Duplicate catalog IDs; validate the dataset before searching.");
  if (collection !== "knowledge" && !records.length)
    throw new Error("Empty recipe catalog; validate the installed package.");
  const sourcesJson = readJson(paths.sources[0]);
  const sources = sourcesJson.value;
  sourcesJson.exact.forEach((exact, index) => LOSSLESS.set(sources[index], exact));
  const catalog = { root, manifest, records, sources };
  cache.set(key, catalog);
  return catalog;
}
function fingerprint(manifest, records) {
  const cached = fingerprints.get(records);
  if (cached?.manifest === manifest)
    return cached.hash;
  const hash = sha256(canonical([lossless(manifest), records.map((r) => lossless(r))]));
  fingerprints.set(records, { manifest, hash });
  return hash;
}
var fingerprints = new WeakMap;
function recordContentHash(record) {
  const { _path, ...stored } = lossless(record);
  return sha256(canonical(stored));
}
function catalogHashes(records) {
  const ordered = [...records].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const digest = (value) => sha256(canonical(value));
  return {
    content_catalog_hash: digest(ordered.map((r) => [r.id, r.revision, recordContentHash(r)])),
    layout_hash: digest(ordered.map((r) => [r.id, r._path]))
  };
}
function fieldText(record, path) {
  let value = record;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return "";
    value = value[part] ?? "";
  }
  if (Array.isArray(value))
    return value.filter((v) => typeof v === "string").join(" ");
  return typeof value === "string" ? value : "";
}

// src/quality-brief.ts
import { existsSync as existsSync3, readFileSync as readFileSync2, statSync as statSync2 } from "fs";
import { join as join4, relative as relative3, resolve as resolve3 } from "path";
var PROBE = "bun scripts/host-probe.js --out host.json";
var TIER_ORDER = ["T0", "T1", "T2", "T3", "T4"];
var UNAVAILABLE = new Set(["missing", "not-proved"]);
var DEFAULT_DELIVERY = "web-desktop";
var DELIVERY = {
  "web-desktop": { cap: "T3" },
  "web-mobile": { cap: "T2", background: "T0" },
  "offline-still": { cap: null },
  presentation: { cap: "T2" }
};
var ROLE_RULES = {
  hero: "host bake ceiling or proved shipped GLB reuse, capped by the delivery target",
  mid: "T2 (procedural surface, no shipped bytes)",
  background: "T1 (instanced repeat, flat material)"
};
var DRAW_CALL_NOTE = "Background and repeated objects stay one InstancedMesh at T1 and are never wrapped in a LOD. " + "Eval run 3 measured 4,773 draw calls at 5 fps with every object built as a separate mesh - " + "that measurement is the concrete reason this note exists. An instanced field is one draw " + "call whatever the count; a LOD per repeat adds a per-frame update and removes no draws.";
var BRIEF_NOTE = "Shipped-kit pipeline recommendations, not limits on artistic quality or construction. " + "Choose kit, adapted kit, custom geometry or sourced assets by object fit. " + "Blender availability does not grade the result; inspect identity, structure, surface " + "and factual fidelity at the intended viewing scale. T0 is an optional layout proxy. " + "Keep the declared proof status when reporting a kit tier.";
function tierView(record) {
  const declared = record.tiers ?? {};
  if (typeof declared !== "object" || Array.isArray(declared))
    throw new Error(`${record.id}.tiers: object required`);
  if ("T1" in declared)
    throw new Error(`${record.id}.tiers: T1 is the record asset, do not declare it`);
  return {
    ...declared,
    T1: {
      mode: "module",
      asset: record.asset ?? null,
      proof: record.proof ?? null,
      poly_budget: record.poly_budget ?? null,
      status: "proved"
    }
  };
}
var index = (tier) => TIER_ORDER.indexOf(tier);
var lowerOf = (first, second) => index(first) <= index(second) ? first : second;
function roleFor(record, heroes) {
  if (heroes.includes(record.id))
    return "hero";
  return (record.tags ?? []).includes("instanced") ? "background" : "mid";
}
function wantedTier(role, ceiling, delivery) {
  const rules = DELIVERY[delivery];
  const cap = rules.cap ?? ceiling;
  if (role === "background") {
    const floor = rules.background ?? "T1";
    return [
      floor,
      floor === "T1" ? "instanced repeat: flat material, one draw call" : `instanced repeat, and ${delivery} caps it at ${floor}`
    ];
  }
  if (role === "hero") {
    const target = lowerOf(ceiling, cap);
    return [
      target,
      target === ceiling ? `hero at the host ceiling ${ceiling}` : `hero wanted the host ceiling ${ceiling}, ${delivery} caps it at ${target}`
    ];
  }
  const target = lowerOf("T2", cap);
  return [
    target,
    target === "T2" ? "mid ground: procedural surface, no shipped bytes" : `mid ground, capped by ${delivery} at ${target}`
  ];
}
var declares = (tiers, name) => tiers[name] ? `declares ${name} ${tiers[name].status}` : `declares no ${name} yet`;
function recommend(record, role, ceiling, delivery, root = skillRoot()) {
  let [target, reason] = wantedTier(role, ceiling, delivery);
  const tiers = tierView(record);
  const baked = tiers.T3;
  const asset = baked?.asset?.path;
  const path = asset ? resolve3(root, asset) : null;
  const reusable = baked?.mode === "gltf" && baked.status === "proved" && path !== null && !relative3(resolve3(root), path).startsWith("..") && existsSync3(path) && statSync2(path).isFile();
  if (role === "hero" && reusable && index(target) < 3) {
    const reuseTarget = lowerOf("T3", DELIVERY[delivery].cap ?? "T3");
    if (index(reuseTarget) > index(target)) {
      target = reuseTarget;
      reason = "hero reuses a proved shipped T3 GLB; local Blender is only needed to rebake; " + `host bake ceiling ${ceiling}, delivery ${delivery}`;
    }
  }
  let tier = target;
  while (tier !== null && (!(tier in tiers) || UNAVAILABLE.has(tiers[tier].status))) {
    const i = index(tier);
    tier = i ? TIER_ORDER[i - 1] : null;
  }
  if (tier === null)
    return [null, `${reason}; the record ${declares(tiers, target)} and offers no lower tier`];
  if (tier !== target)
    return [tier, `${reason}; the record ${declares(tiers, target)}, so ${tier}`];
  return [tier, `${reason}; the record ${declares(tiers, tier)}`];
}
function buildBrief(rows, records, host, delivery, heroes, root = skillRoot()) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const ceiling = host.quality_ceiling;
  const perBlueprint = {};
  for (const row of rows) {
    const record = byId.get(row.id);
    const role = roleFor(record, heroes);
    const [tier, reason] = recommend(record, role, ceiling, delivery, root);
    perBlueprint[row.id] = { role, tier, reason };
  }
  return {
    scope: "shipped-kit-pipelines",
    delivery,
    ceiling,
    ceiling_reason: host.quality_ceiling_reason ?? null,
    capture_mode_expected: host.capture_mode_expected ?? null,
    role_rules: ROLE_RULES,
    per_blueprint: perBlueprint,
    draw_call_note: DRAW_CALL_NOTE,
    note: BRIEF_NOTE
  };
}
function loadHost(path) {
  let host;
  try {
    host = JSON.parse(readFileSync2(path, "utf8"));
  } catch (error) {
    throw new Error(`--host ${path}: ${error.message}. Write one with: ${PROBE}`);
  }
  if (!host || typeof host !== "object" || !TIER_ORDER.includes(host.quality_ceiling))
    throw new Error(`--host ${path}: no quality_ceiling in it. Write one with: ${PROBE}`);
  return host;
}
function checkHeroes(rows, heroes) {
  const listed = new Set(rows.map((r) => r.id));
  const unknown = [...new Set(heroes)].filter((h) => !listed.has(h)).sort();
  if (unknown.length)
    throw new Error(`--hero names records that are not listed blueprints here: ${unknown.join(", ")}`);
}

// ../m3-design/intelligence/ui-ux-pro-max/scripts/difflib.ts
function buildB2j(b) {
  const b2j = new Map;
  b.forEach((element, index) => {
    const indices = b2j.get(element);
    if (indices)
      indices.push(index);
    else
      b2j.set(element, [index]);
  });
  const popular = new Set;
  const n = b.length;
  if (n >= 200) {
    const ntest = Math.floor(n / 100) + 1;
    for (const [element, indices] of b2j) {
      if (indices.length > ntest)
        popular.add(element);
    }
    for (const element of popular)
      b2j.delete(element);
  }
  return { b2j, popular };
}
function findLongestMatch(a, b, b2j, alo, ahi, blo, bhi) {
  let besti = alo;
  let bestj = blo;
  let bestsize = 0;
  let j2len = new Map;
  for (let i = alo;i < ahi; i++) {
    const newj2len = new Map;
    for (const j of b2j.get(a[i]) ?? []) {
      if (j < blo)
        continue;
      if (j >= bhi)
        break;
      const k = (j2len.get(j - 1) ?? 0) + 1;
      newj2len.set(j, k);
      if (k > bestsize) {
        besti = i - k + 1;
        bestj = j - k + 1;
        bestsize = k;
      }
    }
    j2len = newj2len;
  }
  while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
    besti--;
    bestj--;
    bestsize++;
  }
  while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) {
    bestsize++;
  }
  return { i: besti, j: bestj, size: bestsize };
}
function matchingCharacters(a, b) {
  const { b2j } = buildB2j(b);
  const queue = [[0, a.length, 0, b.length]];
  let total = 0;
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    const { i, j, size } = findLongestMatch(a, b, b2j, alo, ahi, blo, bhi);
    if (size) {
      total += size;
      if (alo < i && blo < j)
        queue.push([alo, i, blo, j]);
      if (i + size < ahi && j + size < bhi)
        queue.push([i + size, ahi, j + size, bhi]);
    }
  }
  return total;
}
function sequenceRatio(a, b) {
  const left = Array.from(a);
  const right = Array.from(b);
  const length = left.length + right.length;
  if (length === 0)
    return 1;
  return 2 * matchingCharacters(left, right) / length;
}

// src/resolve.ts
function closeMatch(word, possibilities, cutoff = 0.8) {
  let best;
  for (const x of possibilities) {
    const score = sequenceRatio(x, word);
    if (score < cutoff)
      continue;
    if (!best || score > best.score || score === best.score && x > best.x)
      best = { score, x };
  }
  return best?.x;
}
function blueprintUsage(record) {
  const asset = record.asset;
  const params = record.params ?? [];
  const exactParams = lossless(record).params ?? [];
  const args = params.map((p, i) => `${p.name}: ${pyDumps(exactParams[i]?.default ?? null)}`).join(", ");
  const factory = asset.factory ?? "create";
  const gltf = asset.kind === "gltf-asset";
  const module = gltf ? asset.path.replace(/\.glb$/, ".js") : asset.path;
  const call = `${gltf ? "await " : ""}${factory}({ ${args} })`;
  return {
    asset: asset.path,
    kind: asset.kind,
    factory,
    module,
    awaits: gltf,
    params: Object.fromEntries(params.map((p) => [p.name, p.default])),
    sockets: (record.sockets ?? []).map((s) => s.name),
    detail_ladder: record.detail_ladder ?? null,
    proof: record.proof ?? null,
    snippet: `import { ${factory} } from './${module.split("/").slice(2).join("/")}';
` + `const { group, sockets } = ${call};
` + `scene.add(group);`
  };
}
function resolveRecords(ids, manifest, records, sources, related = false) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const unknown = [...new Set(ids)].filter((id) => !byId.has(id)).sort();
  if (unknown.length) {
    const named = unknown.map((rid) => {
      const close = closeMatch(rid, byId.keys());
      return close ? `${rid} (did you mean ${close}?)` : rid;
    });
    throw new Error(`Unknown record IDs: ${named.join(", ")}`);
  }
  const chosen = [...new Set(ids)];
  if (related) {
    for (const rid of [...chosen]) {
      for (const neighbor of byId.get(rid).related_ids ?? []) {
        if (!byId.has(neighbor))
          throw new Error(`Dangling relationship: ${rid} -> ${neighbor}`);
        if (!chosen.includes(neighbor))
          chosen.push(neighbor);
      }
    }
  }
  const selected = chosen.map((id) => byId.get(id));
  const sourceIds = new Set(selected.flatMap((r) => (r.claims ?? []).flatMap((c) => (c.source_refs ?? []).map((ref) => ref.source_id))));
  const bySource = new Map(sources.map((s) => [s.id, s]));
  const missing = [...sourceIds].filter((id) => !bySource.has(id)).sort();
  if (missing.length)
    throw new Error(`Unknown source IDs: ${missing.join(", ")}`);
  const selectedSources = [...sourceIds].sort().map((id) => bySource.get(id));
  const bundle = canonical([selected.map((r) => lossless(r)), selectedSources.map((s) => lossless(s))]);
  const result = {
    catalog_hash: fingerprint(manifest, records),
    bundle_hash: sha256(bundle),
    selected_ids: [...new Set(ids)],
    records: selected,
    sources: selectedSources,
    notice: "These are authored records and source metadata, not new source reads " + "or runtime verification. Apply only the guidance relevant to the task."
  };
  const blueprints = Object.fromEntries(selected.filter((r) => ("asset" in r)).map((r) => [r.id, blueprintUsage(r)]));
  if (Object.keys(blueprints).length)
    result.blueprints = blueprints;
  return result;
}

// src/search.ts
var pySorted = (values) => [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
function expand(query, cfg) {
  const terms = new Set(tokens(query));
  const normalized = normalize(query);
  const added = new Set;
  for (const [phrase, extra] of Object.entries(cfg.query_aliases ?? {})) {
    if (new RegExp(`(?<!${WORD})${escapeRegExp(phrase)}(?!${WORD})`, "u").test(normalized)) {
      for (const term of extra)
        for (const token of tokens(term))
          added.add(token);
    }
  }
  return { terms: new Set([...terms, ...added]), expanded: new Set([...added].filter((t) => !terms.has(t))) };
}
var corpusCache = new WeakMap;
function corpusFor(active, field) {
  let fields = corpusCache.get(active);
  if (!fields)
    corpusCache.set(active, fields = new Map);
  let corpus = fields.get(field);
  if (corpus)
    return corpus;
  const bags = active.map((record) => {
    const bag = new Map;
    for (const token of tokens(fieldText(record, field)))
      bag.set(token, (bag.get(token) ?? 0) + 1);
    return bag;
  });
  const lengths = bags.map((bag) => [...bag.values()].reduce((a, b) => a + b, 0));
  const df = new Map;
  for (const bag of bags)
    for (const term of bag.keys())
      df.set(term, (df.get(term) ?? 0) + 1);
  corpus = { bags, lengths, average: lengths.reduce((a, b) => a + b, 0) / Math.max(active.length, 1), df };
  fields.set(field, corpus);
  return corpus;
}
var activeCache = new WeakMap;
function activeRecords(records, collection) {
  let byCollection = activeCache.get(records);
  if (!byCollection)
    activeCache.set(records, byCollection = new Map);
  let active = byCollection.get(collection);
  if (!active) {
    const prefix = collection === "recipes" ? "recipe." : "knowledge.";
    active = records.filter((r) => r.status === "active" && (collection === "all" || r.id.startsWith(prefix)));
    byCollection.set(collection, active);
  }
  return active;
}
var round6 = (x) => Number(x.toFixed(6));
function search(query, manifest, records, options = {}) {
  const { limit = 5, direction = null, excludeIds = [], algorithm = null, collection = "recipes", kind = null } = options;
  if (!COLLECTIONS.has(collection) || kind !== null && !KNOWLEDGE_KINDS.has(kind))
    throw new Error("Unknown collection or knowledge kind");
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    throw new Error("limit must be between 1 and 20");
  const cfg = manifest.search;
  const method = algorithm ?? cfg.algorithm;
  if (method !== "weighted-field-bm25" && method !== "overlap")
    throw new Error("Unknown search algorithm");
  const { terms, expanded } = expand(query, cfg);
  const active = activeRecords(records, collection);
  const n = active.length;
  const excluded = new Set(excludeIds);
  const queryTokens = tokens(query).join("\x00");
  const exactQuery = casefold(query.trim());
  const results = [];
  const corpora = Object.keys(cfg.fields).map((field) => [field, corpusFor(active, field)]);
  active.forEach((record, i) => {
    if (excluded.has(record.id) || direction && !(record.direction_ids ?? []).includes(direction))
      return;
    if (kind && record.knowledge_kind !== kind)
      return;
    const exact = exactQuery === casefold(record.id);
    const alias = (record.aliases?.en ?? []).some((a) => tokens(a).join("\x00") === queryTokens);
    let score = 0;
    const matches = [];
    for (const [field, corpus] of corpora) {
      const boost = cfg.fields[field];
      const bag = corpus.bags[i];
      const hit = [...terms].filter((t) => bag.has(t));
      if (!hit.length)
        continue;
      matches.push(field);
      if (method === "overlap") {
        score += boost * hit.length;
        continue;
      }
      const length = corpus.lengths[i];
      for (const term of hit) {
        const df = corpus.df.get(term) ?? 0;
        const idf = Math.log1p((n - df + 0.5) / (df + 0.5));
        const tf = bag.get(term);
        const denominator = tf + cfg.k1 * (1 - cfg.b + cfg.b * length / Math.max(corpus.average, 1));
        score += boost * idf * tf * (cfg.k1 + 1) / denominator;
      }
    }
    if (terms.size && (score > 0 || exact || alias)) {
      results.push({
        id: record.id,
        revision: record.revision,
        title: record.title.en,
        path: record._path,
        collection: record.id.startsWith("knowledge.") ? "knowledge" : "recipes",
        kind: record.knowledge_kind ?? "recipe",
        score: round6(score),
        exact_id: exact,
        exact_alias: alias,
        matched_fields: matches,
        summary: record.summary
      });
    }
  });
  results.sort((a, b) => Number(b.exact_id) - Number(a.exact_id) || Number(b.exact_alias) - Number(a.exact_alias) || b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ambiguous = results.filter((r) => r.exact_alias).length > 1;
  const hint = !results.length ? "no match: describe the look in plain words; the catalog is not a menu" : results.length < 3 ? "few candidates: rephrase in plain words, or narrow with --kind style-profile / --kind lighting-profile" : "";
  return {
    status: ambiguous ? "ambiguous" : results.length ? "candidates" : "no-match",
    query,
    algorithm: method,
    index_version: cfg.version,
    expanded_terms: pySorted(expanded),
    hint,
    catalog_hash: fingerprint(manifest, records),
    results: results.slice(0, limit),
    notice: "Lexical candidates only. Interpret negation and intent before choosing. " + "Scores are not probabilities; no match does not limit creative capability."
  };
}

// src/design-context.ts
var LOOK_KINDS = new Set(["style-profile", "lighting-profile", "theme-profile"]);
var ASSEMBLY_STEP = "Assess each blueprint against the intended silhouette, structure, behavior and finish. " + "Reuse, adapt, reject or combine it with custom or sourced geometry by actual fit. " + "A matching noun does not require using its kit; document choices when useful.";
var NEXT_STEP = "Interpret the user constraints and negation yourself. Select useful " + "records, research factual claims, then synthesize a coherent design " + "with custom choices. Do not present this retrieval output as a " + "completed design system or treat absent matches as a capability limit.";
function blueprintsFor(records, looks) {
  const chosen = new Set(looks);
  const rows = [];
  for (const record of records) {
    if (record.knowledge_kind !== "blueprint" || record.status !== "active")
      continue;
    const fits = record.fits_looks ?? [];
    if (chosen.size && !fits.some((look) => chosen.has(look)))
      continue;
    const asset = record.asset;
    rows.push({
      id: record.id,
      title: record.title.en,
      asset: asset.path,
      kind: asset.kind,
      footprint_m: record.footprint_m,
      poly_budget: record.poly_budget,
      sockets: record.sockets.map((s) => s.name),
      detail_ladder: record.detail_ladder,
      params: Object.fromEntries(record.params.map((p) => [p.name, p.default]))
    });
  }
  return rows.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function checkLooks(records, looks) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const unique = [...new Set(looks)];
  const unknown = unique.filter((look) => !byId.has(look)).sort();
  if (unknown.length)
    throw new Error(`Unknown record IDs: ${unknown.join(", ")}`);
  const wrong = unique.filter((look) => !LOOK_KINDS.has(byId.get(look).knowledge_kind ?? "")).sort();
  if (wrong.length)
    throw new Error(`Not a style, theme or lighting profile: ${wrong.join(", ")}`);
}
function gather(query, catalog, options = {}) {
  const { manifest, records, sources } = catalog;
  const {
    direction = null,
    kinds = [],
    excludeIds = [],
    blueprints = false,
    looks = [],
    host = null,
    delivery = DEFAULT_DELIVERY,
    heroes = []
  } = options;
  if (!query.trim())
    throw new Error("A nonempty objective is required");
  if (kinds.some((kind) => !KNOWLEDGE_KINDS.has(kind)))
    throw new Error("Unknown knowledge kind");
  if (looks.length && !blueprints)
    throw new Error("--look only applies with --blueprints");
  if ((host || heroes.length) && !blueprints)
    throw new Error("--host and --hero only apply with --blueprints");
  if (heroes.length && !host)
    throw new Error(`--hero needs the host ceiling. Write one with: ${PROBE}`);
  if (!(delivery in DELIVERY))
    throw new Error(`Unknown delivery target ${delivery}: one of ${JSON.stringify(Object.keys(DELIVERY).sort())}`);
  checkLooks(records, looks);
  const groups = {
    recipes: search(query, manifest, records, { limit: 3, direction, excludeIds, collection: "recipes" })
  };
  for (const kind of kinds) {
    groups[kind] = search(query, manifest, records, { limit: 2, direction, excludeIds, collection: "knowledge", kind });
  }
  const ids = [...new Set(Object.values(groups).flatMap((group) => group.results.map((r) => r.id)))];
  const context = resolveRecords(ids, manifest, records, sources);
  const result = {
    objective: query,
    status: ids.length ? "candidates" : "no-match",
    candidate_groups: groups,
    context,
    next_step: NEXT_STEP
  };
  if (blueprints) {
    const rows = blueprintsFor(records, looks);
    result.blueprints = rows;
    result.next_step = `${NEXT_STEP} ${ASSEMBLY_STEP}`;
    if (host) {
      checkHeroes(rows, heroes);
      result.quality_brief = buildBrief(rows, records, host, delivery, heroes, catalog.root);
    }
  }
  return result;
}

// src/commands.ts
class UsageError extends Error {
}
function parse(argv, options) {
  try {
    return parseArgs({ args: argv, options: { help: { type: "boolean", short: "h" }, ...options }, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(error.message);
  }
}
function choice(value, allowed, flag) {
  if (value === undefined)
    return;
  const set = new Set(allowed);
  if (!set.has(value))
    throw new UsageError(`${flag}: invalid choice '${value}' (choose from ${[...set].sort().join(", ")})`);
  return value;
}
var SEARCH_HELP = `usage: search.js <query> [--limit N] [--direction ID] [--collection all|recipes|knowledge]
                 [--kind KIND] [--exclude-id ID]... [--algorithm overlap|weighted-field-bm25]
Lexical suggestions, not a semantic router or a probability of correctness.`;
function searchCommand(argv) {
  const { values, positionals } = parse(argv, {
    limit: { type: "string" },
    direction: { type: "string" },
    collection: { type: "string" },
    kind: { type: "string" },
    "exclude-id": { type: "string", multiple: true },
    algorithm: { type: "string" }
  });
  if (values.help)
    return SEARCH_HELP;
  const [query, ...extra] = positionals;
  if (query === undefined || extra.length)
    throw new UsageError(SEARCH_HELP);
  const collection = choice(values.collection, COLLECTIONS, "--collection") ?? "all";
  const kind = choice(values.kind, KNOWLEDGE_KINDS, "--kind") ?? null;
  const algorithm = choice(values.algorithm, ["overlap", "weighted-field-bm25"], "--algorithm") ?? null;
  const limit = values.limit === undefined ? 5 : Number(values.limit);
  if (!Number.isInteger(limit))
    throw new UsageError(`--limit: invalid int value '${values.limit}'`);
  try {
    const { manifest, records } = loadCatalog(undefined, collection);
    return search(query, manifest, records, {
      limit,
      direction: values.direction ?? null,
      excludeIds: values["exclude-id"] ?? [],
      algorithm,
      collection,
      kind
    });
  } catch (error) {
    throw new UsageError(error.message);
  }
}
var RESOLVE_HELP = `usage: resolve.js <id>... [--related]
Resolve explicitly selected records and their sources without guessing intent.`;
function resolveCommand(argv) {
  const { values, positionals } = parse(argv, { related: { type: "boolean" } });
  if (values.help)
    return RESOLVE_HELP;
  if (!positionals.length)
    throw new UsageError(RESOLVE_HELP);
  try {
    const { manifest, records, sources } = loadCatalog(undefined, "all");
    return resolveRecords(positionals, manifest, records, sources, Boolean(values.related));
  } catch (error) {
    throw new UsageError(error.message);
  }
}
var CONTEXT_HELP = `usage: design-context.js <objective> [--direction ID] [--kind KIND]... [--exclude-id ID]...
                         [--blueprints [--look ID]... [--host host.json [--delivery TARGET] [--hero ID]...]]
Gather optional lexical context for the agent to synthesize a 3D design.
--host takes the report of: ${PROBE}; --delivery is one of ${Object.keys(DELIVERY).sort().join(", ")}.`;
function contextCommand(argv) {
  const { values, positionals } = parse(argv, {
    direction: { type: "string" },
    kind: { type: "string", multiple: true },
    "exclude-id": { type: "string", multiple: true },
    blueprints: { type: "boolean" },
    look: { type: "string", multiple: true },
    host: { type: "string" },
    delivery: { type: "string" },
    hero: { type: "string", multiple: true }
  });
  if (values.help)
    return CONTEXT_HELP;
  const [query, ...extra] = positionals;
  if (query === undefined || extra.length)
    throw new UsageError(CONTEXT_HELP);
  for (const kind of values.kind ?? [])
    choice(kind, KNOWLEDGE_KINDS, "--kind");
  const delivery = choice(values.delivery, Object.keys(DELIVERY), "--delivery") ?? DEFAULT_DELIVERY;
  try {
    const catalog = loadCatalog(undefined, "all");
    return gather(query, catalog, {
      direction: values.direction ?? null,
      kinds: values.kind ?? [],
      excludeIds: values["exclude-id"] ?? [],
      blueprints: Boolean(values.blueprints),
      looks: values.look ?? [],
      host: values.host ? loadHost(values.host) : null,
      delivery,
      heroes: values.hero ?? []
    });
  } catch (error) {
    throw new UsageError(error.message);
  }
}

// src/assets.ts
var assetsDir = () => join5(resolve4(Bun.env.VIZ3D_CACHE ?? join5(homedir(), ".cache", "aphrody", "viz3d")), "assets");
async function fetchAssets(options = {}) {
  const studies = studiesDir();
  if (!studies)
    throw new Error("the studies ship with the @aphrody/viz3d workspace package, not the skill");
  const manifest = JSON.parse(readFileSync3(join5(studies, "assets-manifest.json"), "utf8"));
  const out = assetsDir();
  let fetched = 0, skipped = 0, bytes = 0;
  const failed = [];
  for (const file of manifest.files) {
    if (options.only && !file.key.startsWith(options.only))
      continue;
    if (file.key.split("/").includes(".."))
      throw new Error(`unsafe key ${file.key}`);
    const target = join5(out, file.key);
    if (existsSync4(target) && sha256(readFileSync3(target)) === file.sha256) {
      skipped++;
      continue;
    }
    const response = await fetch(new URL(file.key, manifest.base));
    const body = new Uint8Array(await response.arrayBuffer());
    if (!response.ok || sha256(body) !== file.sha256) {
      failed.push(`${file.key}: ${response.ok ? "sha256 mismatch" : `HTTP ${response.status}`}`);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    await Bun.write(target, body);
    fetched++;
    bytes += body.length;
  }
  return { dir: out, fetched, skipped, bytes, failed };
}
async function fetchAssetsCommand(argv) {
  const { values } = parse(argv, { only: { type: "string" } });
  if (values.help) {
    console.log(`usage: viz3d fetch-assets [--only anatomy/]
Download the study meshes into the local cache, verifying sha256.`);
    return 0;
  }
  const report = await fetchAssets({ only: values.only });
  console.log(JSON.stringify(report, null, 2));
  return report.failed.length ? 1 : 0;
}
// ../bun-blender/src/discover.ts
import { homedir as homedir2 } from "os";
import { dirname as dirname2, join as join6 } from "path";
var SEARCH_ROOTS = {
  win32: [`${Bun.env.LOCALAPPDATA ?? ""}/Programs`, "C:/src/blender-build", "C:/Program Files/Blender Foundation"],
  darwin: ["/Applications"],
  linux: ["/opt", "/usr/local"]
};
var STANDARD_PATHS = {
  darwin: ["/Applications/Blender.app/Contents/MacOS/Blender", join6(homedir2(), "Applications/Blender.app/Contents/MacOS/Blender")],
  linux: ["/usr/bin/blender", "/usr/local/bin/blender", "/snap/bin/blender", "/var/lib/flatpak/exports/bin/org.blender.Blender"]
};
async function scan(pattern, cwd, onlyFiles = true) {
  const hits = [];
  try {
    for await (const hit of new Bun.Glob(pattern).scan({ cwd, onlyFiles }))
      hits.push(hit);
  } catch {}
  return hits.sort();
}
async function blenderCandidates() {
  const out = [];
  if (Bun.env.BLENDER_PATH)
    out.push({ executable: Bun.env.BLENDER_PATH, source: "BLENDER_PATH" });
  const which = Bun.which("blender");
  if (which)
    out.push({ executable: which, source: "PATH" });
  const pattern = process.platform === "win32" ? "{Blender*,bin}/blender.exe" : "[Bb]lender*/blender";
  for (const root of SEARCH_ROOTS[process.platform] ?? []) {
    for (const hit of (await scan(pattern, root)).reverse())
      out.push({ executable: join6(root, hit), source: "standard install path" });
  }
  for (const path of STANDARD_PATHS[process.platform] ?? [])
    out.push({ executable: path, source: "standard install path" });
  const seen = new Set;
  const existing = [];
  for (const candidate of out) {
    if (seen.has(candidate.executable))
      continue;
    seen.add(candidate.executable);
    if (await Bun.file(candidate.executable).exists())
      existing.push(candidate);
  }
  return existing;
}
// ../bun-blender/src/plugin.ts
import { join as join7 } from "path";
var HEADLESS = join7(import.meta.dir, "headless.ts");
// ../bun-blender/src/bridge.ts
var HOST = Bun.env.BLENDER_MCP_HOST ?? "127.0.0.1";
var PORT = Number(Bun.env.BLENDER_MCP_PORT ?? 9876);
// ../bun-blender/src/ffi.ts
import { dlopen, FFIType } from "bun:ffi";
var symbols = {
  Py_IsInitialized: { args: [], returns: FFIType.i32 },
  Py_InitializeEx: { args: [FFIType.i32], returns: FFIType.void },
  PyRun_SimpleString: { args: [FFIType.cstring], returns: FFIType.i32 },
  Py_GetVersion: { args: [], returns: FFIType.cstring }
};
// src/blender.ts
var MIN_VERSION = [4, 2];
async function blenderVersion(path, timeoutMs = 5000) {
  try {
    const proc = Bun.spawn([path, "--version"], { stdout: "pipe", stderr: "ignore", timeout: timeoutMs, windowsHide: true });
    const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    const match = /Blender\s+(\d+)\.(\d+)(?:\.(\d+))?/.exec(out);
    return match ? match.slice(1).filter(Boolean).join(".") : null;
  } catch {
    return null;
  }
}
async function findBlender2() {
  for (const candidate of await blenderCandidates()) {
    const version = await blenderVersion(candidate.executable);
    if (!version)
      continue;
    const [major = 0, minor = 0] = version.split(".").map(Number);
    const onPath = candidate.source === "PATH";
    return {
      found: true,
      path: candidate.executable,
      version,
      on_path: onPath,
      meets_minimum: major > MIN_VERSION[0] || major === MIN_VERSION[0] && minor >= MIN_VERSION[1],
      source: `${candidate.source} + --version`
    };
  }
  return {
    found: false,
    path: null,
    version: null,
    on_path: false,
    meets_minimum: false,
    source: "no runnable candidate on BLENDER_PATH, PATH or standard paths"
  };
}

// src/capture.ts
import { mkdirSync as mkdirSync4, writeFileSync } from "fs";
import { join as join10, relative as relative5, resolve as resolve6 } from "path";

// ../chromium/src/modules/chromium.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ../chromium/src/modules/chrome-manifests.ts
var ObjectKeys = Object.keys;
var ObjectGetPrototypeOf = Object.getPrototypeOf;
var ObjectDefineProperty = Object.defineProperty;
var ObjectPrototype = Object.prototype;
var NumberIsFinite = Number.isFinite;
var RegExpExec = RegExp.prototype.exec;
var StringSplit = String.prototype.split;
var StringTrim = String.prototype.trim;
var StringStartsWith = String.prototype.startsWith;
var ArrayIncludes = Array.prototype.includes;
var URLConstructor = URL;
function matches(pattern, value) {
  return RegExpExec.call(pattern, value) !== null;
}
function object(value, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}
function string(value, field) {
  if (typeof value !== "string" || StringTrim.call(value).length === 0 || matches(/\0/, value)) {
    throw new TypeError(`${field} must be a nonempty string without NUL characters`);
  }
  return value;
}
function array(value, field) {
  if (!Array.isArray(value))
    throw new TypeError(`${field} must be an array`);
  return value;
}
function copyJSON(value, field, ancestors = []) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && NumberIsFinite(value))
    return value;
  if (typeof value !== "object")
    throw new TypeError(`${field} must contain JSON values`);
  for (let i = 0;i < ancestors.length; i++) {
    if (ancestors[i] === value)
      throw new TypeError(`${field} must not contain a cycle`);
  }
  const isArray = Array.isArray(value);
  if (!isArray) {
    const prototype = ObjectGetPrototypeOf(value);
    if (prototype !== null && prototype !== ObjectPrototype) {
      throw new TypeError(`${field} must contain plain JSON objects`);
    }
  }
  ancestors[ancestors.length] = value;
  const result = isArray ? [] : { __proto__: null };
  if (isArray) {
    for (let i = 0;i < value.length; i++)
      result[i] = copyJSON(value[i], `${field}[${i}]`, ancestors);
  } else {
    const keys = ObjectKeys(value);
    for (let i = 0;i < keys.length; i++) {
      const key = keys[i];
      ObjectDefineProperty(result, key, {
        value: copyJSON(value[key], `${field}.${key}`, ancestors),
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
  }
  ancestors.length--;
  return result;
}
function resource(value, field) {
  string(value, field);
  if (matches(/^[\\/]|[\\\0?#:]|(^|\/)\.\.?($|\/)/, value)) {
    throw new TypeError(`${field} must be a relative package resource without traversal`);
  }
  if (matches(/%(?:00|2e|2f|5c)/i, value)) {
    throw new TypeError(`${field} must not contain encoded path separators or dot segments`);
  }
}
function resources(value, field) {
  const items = array(value, field);
  for (let i = 0;i < items.length; i++)
    resource(items[i], `${field}[${i}]`);
}
function resourceMap(value, field) {
  object(value, field);
  const keys = ObjectKeys(value);
  for (let i = 0;i < keys.length; i++)
    resource(value[keys[i]], `${field}.${keys[i]}`);
}
function identity(manifest) {
  string(manifest.name, "name");
  string(manifest.version, "version");
  if (manifest.manifest_version !== 3)
    throw new RangeError("manifest_version must be 3");
  if (!matches(/^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/, manifest.version)) {
    throw new TypeError("version must contain one to four dot-separated integers without leading zeros");
  }
  const parts = StringSplit.call(manifest.version, ".");
  let nonzero = false;
  for (let i = 0;i < parts.length; i++) {
    const part = +parts[i];
    if (part > 65535)
      throw new RangeError("version components must not exceed 65535");
    if (part !== 0)
      nonzero = true;
  }
  if (!nonzero)
    throw new RangeError("version must not be all zero");
  const icons = manifest.icons;
  if (icons !== undefined)
    resourceMap(icons, "icons");
}
function hostPattern(value, field) {
  string(value, field);
  if (value === "<all_urls>")
    return;
  if (!matches(/^(\*|https?|file|ftp):\/\/([^/]+|)\/[^\s\0]*$/, value)) {
    throw new TypeError(`${field} must be a Chrome host match pattern`);
  }
  const parts = StringSplit.call(value, "/");
  const scheme = parts[0];
  const host = parts[2];
  if (scheme === "file:") {
    if (host !== "")
      throw new TypeError(`${field} file patterns must have an empty host`);
  } else if (!host || matches(/[@:#?\\\s]/, host) || matches(/\*/, host) && host !== "*" && !matches(/^\*\.[^*]+$/, host)) {
    throw new TypeError(`${field} has an invalid host`);
  }
}
function permissions(value, field, hosts) {
  const items = array(value, field);
  for (let i = 0;i < items.length; i++) {
    const name = `${field}[${i}]`;
    if (hosts)
      hostPattern(items[i], name);
    else if (!matches(/^[a-zA-Z][a-zA-Z0-9_.]*$/, string(items[i], name))) {
      throw new TypeError(`${name} must be a permission name; use host_permissions for host patterns`);
    }
  }
}
function validateExtension(input) {
  const manifest = copyJSON(object(input, "manifest"), "manifest");
  identity(manifest);
  if (manifest.theme !== undefined)
    throw new TypeError("Extension manifests must not contain theme");
  for (const key of ["browser_action", "page_action"]) {
    if (manifest[key] !== undefined)
      throw new TypeError(`Manifest V3 must use action instead of ${key}`);
  }
  for (const key of ["permissions", "optional_permissions", "host_permissions", "optional_host_permissions"]) {
    const value = manifest[key];
    if (value !== undefined)
      permissions(value, key, key === "host_permissions" || key === "optional_host_permissions");
  }
  const backgroundValue = manifest.background;
  if (backgroundValue !== undefined) {
    const background = object(backgroundValue, "background");
    resource(background.service_worker, "background.service_worker");
    if (background.scripts !== undefined || background.page !== undefined || background.persistent !== undefined) {
      throw new TypeError("Manifest V3 background must use service_worker instead of scripts, page or persistent");
    }
    const type = background.type;
    if (type !== undefined && type !== "module")
      throw new TypeError('background.type must be "module"');
  }
  const actionValue = manifest.action;
  if (actionValue !== undefined) {
    const action = object(actionValue, "action");
    const popup = action.default_popup;
    if (popup !== undefined && popup !== "")
      resource(popup, "action.default_popup");
    const icon = action.default_icon;
    if (typeof icon === "string")
      resource(icon, "action.default_icon");
    else if (icon !== undefined)
      resourceMap(icon, "action.default_icon");
  }
  const sidePanel = manifest.side_panel;
  if (sidePanel !== undefined) {
    resource(object(sidePanel, "side_panel").default_path, "side_panel.default_path");
  }
  const devtoolsPage = manifest.devtools_page;
  if (devtoolsPage !== undefined)
    resource(devtoolsPage, "devtools_page");
  const optionsPage = manifest.options_page;
  if (optionsPage !== undefined)
    resource(optionsPage, "options_page");
  const optionsUI = manifest.options_ui;
  if (optionsUI !== undefined)
    resource(object(optionsUI, "options_ui").page, "options_ui.page");
  const overrides = manifest.chrome_url_overrides;
  if (overrides !== undefined)
    resourceMap(overrides, "chrome_url_overrides");
  const contentScripts = manifest.content_scripts;
  if (contentScripts !== undefined) {
    const scripts = array(contentScripts, "content_scripts");
    for (let i = 0;i < scripts.length; i++) {
      const entry = object(scripts[i], `content_scripts[${i}]`);
      const js = entry.js;
      const css = entry.css;
      if (js !== undefined)
        resources(js, `content_scripts[${i}].js`);
      if (css !== undefined)
        resources(css, `content_scripts[${i}].css`);
      permissions(entry.matches, `content_scripts[${i}].matches`, true);
    }
  }
  const webResources = manifest.web_accessible_resources;
  if (webResources !== undefined) {
    const entries = array(webResources, "web_accessible_resources");
    for (let i = 0;i < entries.length; i++) {
      const entry = object(entries[i], `web_accessible_resources[${i}]`);
      resources(entry.resources, `web_accessible_resources[${i}].resources`);
      const matchesValue = entry.matches;
      if (matchesValue !== undefined)
        permissions(matchesValue, `web_accessible_resources[${i}].matches`, true);
    }
  }
  return manifest;
}
function createExtension(input) {
  return validateExtension({ manifest_version: 3, version: "1.0.0", ...object(input, "options") });
}
function validateTheme(input) {
  const manifest = copyJSON(object(input, "manifest"), "manifest");
  identity(manifest);
  const theme = object(manifest.theme, "theme");
  for (const key of [
    "background",
    "action",
    "browser_action",
    "page_action",
    "content_scripts",
    "permissions",
    "optional_permissions",
    "host_permissions",
    "optional_host_permissions",
    "devtools_page",
    "side_panel",
    "options_page",
    "options_ui",
    "chrome_url_overrides",
    "web_accessible_resources",
    "declarative_net_request",
    "commands",
    "omnibox"
  ]) {
    if (manifest[key] !== undefined)
      throw new TypeError(`Theme manifests must not contain ${key}`);
  }
  const images = theme.images;
  if (images !== undefined)
    resourceMap(images, "theme.images");
  for (const key of ["colors", "tints"]) {
    const value = theme[key];
    if (value === undefined)
      continue;
    const values = object(value, `theme.${key}`);
    for (const name of ObjectKeys(values)) {
      const field = `theme.${key}.${name}`;
      const components = array(values[name], field);
      if (components.length !== 3 && !(key === "colors" && components.length === 4)) {
        throw new TypeError(`${field} must have three components${key === "colors" ? " or four for RGBA" : ""}`);
      }
      for (let i = 0;i < components.length; i++) {
        const component = components[i];
        if (typeof component !== "number" || !NumberIsFinite(component))
          throw new TypeError(`${field}[${i}] must be finite`);
        if (key === "tints") {
          if (component !== -1 && (component < 0 || component > 1))
            throw new RangeError(`${field}[${i}] must be -1 or between 0 and 1`);
        } else if (component < 0 || component > (i === 3 ? 1 : 255) || i < 3 && component % 1 !== 0) {
          throw new RangeError(`${field}[${i}] must be ${i === 3 ? "between 0 and 1" : "an integer between 0 and 255"}`);
        }
      }
    }
  }
  return manifest;
}
function createTheme(input) {
  return validateTheme({
    manifest_version: 3,
    version: "1.0.0",
    theme: {},
    ...object(input, "options")
  });
}
function httpURL(value, field, base) {
  string(value, field);
  const url = new URLConstructor(value, base);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new TypeError(`${field} must use HTTP or HTTPS`);
  if (url.username || url.password)
    throw new TypeError(`${field} must not contain credentials`);
  return url;
}
function validatePWA(input) {
  const manifest = copyJSON(object(input, "manifest"), "manifest");
  string(manifest.name, "name");
  const start = httpURL(manifest.start_url, "start_url");
  manifest.start_url = start.href;
  const scopeValue = manifest.scope;
  if (scopeValue !== undefined) {
    const scope = httpURL(scopeValue, "scope", start.href);
    if (scope.origin !== start.origin || !StringStartsWith.call(start.pathname, scope.pathname)) {
      throw new RangeError("start_url must be within scope on the same origin");
    }
    scope.search = "";
    scope.hash = "";
    manifest.scope = scope.href;
  }
  const display = manifest.display;
  if (display !== undefined && !ArrayIncludes.call(["fullscreen", "standalone", "minimal-ui", "browser"], display)) {
    throw new TypeError("display must be fullscreen, standalone, minimal-ui or browser");
  }
  const iconsValue = manifest.icons;
  if (iconsValue !== undefined) {
    const icons = array(iconsValue, "icons");
    for (let i = 0;i < icons.length; i++) {
      const icon = object(icons[i], `icons[${i}]`);
      icon.src = httpURL(icon.src, `icons[${i}].src`, start.href).href;
      const sizes = icon.sizes;
      if (sizes !== undefined && !matches(/^(any|[1-9]\d*x[1-9]\d*)( +(any|[1-9]\d*x[1-9]\d*))*$/, string(sizes, `icons[${i}].sizes`))) {
        throw new TypeError(`icons[${i}].sizes must contain dimensions or any`);
      }
      const type = icon.type;
      if (type !== undefined)
        string(type, `icons[${i}].type`);
      const purpose = icon.purpose;
      if (purpose !== undefined && !matches(/^(any|maskable|monochrome)( +(any|maskable|monochrome))*$/, string(purpose, `icons[${i}].purpose`))) {
        throw new TypeError(`icons[${i}].purpose must contain any, maskable or monochrome`);
      }
    }
  }
  return manifest;
}
function createPWA(input) {
  const manifest = { display: "standalone", ...object(input, "options") };
  return validatePWA(manifest);
}
var chrome_manifests_default = {
  validateExtension,
  createExtension,
  validateTheme,
  createTheme,
  validatePWA,
  createPWA
};

// ../chromium/src/modules/process.ts
import { dlopen as dlopen2, FFIType as FFIType2 } from "bun:ffi";
import { constants as osConstants } from "os";
var SYS = {
  x64: { pidfd_open: 434, pidfd_send_signal: 424 },
  arm64: { pidfd_open: 434, pidfd_send_signal: 424 },
  riscv64: { pidfd_open: 434, pidfd_send_signal: 424 }
};
var constants = Object.freeze({
  PIDFD_SIGNAL_THREAD: 1,
  PIDFD_SIGNAL_THREAD_GROUP: 2,
  PIDFD_SIGNAL_PROCESS_GROUP: 4
});
var ERRNO = { 1: "EPERM", 3: "ESRCH", 9: "EBADF", 22: "EINVAL", 38: "ENOSYS" };
var cached;
function linuxProcessGroup() {
  if (cached)
    return cached;
  const numbers = SYS[process.arch];
  if (!numbers)
    throw new Error(`pidfd syscalls are not mapped for ${process.arch}`);
  const libc = dlopen2("libc.so.6", {
    syscall: { args: [FFIType2.i64, FFIType2.i64, FFIType2.i64, FFIType2.i64, FFIType2.i64], returns: FFIType2.i64 },
    __errno_location: { args: [], returns: FFIType2.ptr }
  }).symbols;
  const { read } = __require("bun:ffi");
  const fail = (call) => {
    const errno = read.i32(libc.__errno_location(), 0);
    const code = ERRNO[errno] ?? `E${errno}`;
    throw Object.assign(new Error(`${call} failed: ${code}`), { code, errno });
  };
  const signalNumber = (signal) => {
    if (typeof signal === "number")
      return signal;
    const value = osConstants.signals[signal];
    if (value === undefined)
      throw new TypeError(`unknown signal ${signal}`);
    return value;
  };
  cached = {
    constants,
    pidfdOpen(pid) {
      const fd = Number(libc.syscall(numbers.pidfd_open, pid, 0, 0, 0));
      return fd < 0 ? fail("pidfd_open") : fd;
    },
    pidfdForProcess(proc) {
      return Number.isSafeInteger(proc?.pid) ? cached.pidfdOpen(proc.pid) : null;
    },
    pidfdSendSignal(pidfd, signal, flags = 0) {
      const rc = Number(libc.syscall(numbers.pidfd_send_signal, pidfd, signalNumber(signal), 0, flags));
      if (rc < 0)
        fail("pidfd_send_signal");
    }
  };
  return cached;
}
function windowsJob() {
  try {
    const windows = __require("bun:windows");
    const Job = windows.Job ?? windows.default?.Job;
    return Job ? new Job(undefined) : undefined;
  } catch {
    return;
  }
}

// ../chromium/src/modules/chromium.ts
function timeoutValue(value) {
  const result = value ?? 1e4;
  if (!Number.isSafeInteger(result) || result < 1 || result > 2147483647)
    throw new RangeError("timeout must be an integer from 1 to 2147483647 milliseconds");
  return result;
}
function endpointURL(endpoint, discovery = false) {
  const url = new URL(endpoint);
  if (!(discovery ? ["ws:", "wss:", "http:", "https:"] : ["ws:", "wss:"]).includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.hash)
    throw new TypeError("CDP endpoint must be a loopback debugging URL without credentials or fragment");
  return url.href;
}
function validateURL(value) {
  if (value === "about:blank")
    return value;
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new TypeError("navigation URL must use HTTP(S) without credentials, or about:blank");
  return url.href;
}

class ChromiumConnection {
  #socket;
  #timeout;
  #nextId = 0;
  #pending = new Map;
  #listeners = new Map;
  #closed = false;
  #removeAbort;
  constructor(socket, timeout, signal) {
    this.#socket = socket;
    this.#timeout = timeout;
    socket.addEventListener("message", (event) => this.#message(event));
    socket.addEventListener("close", () => this.close());
    socket.addEventListener("error", () => this.close());
    if (signal) {
      const abort = () => this.close();
      signal.addEventListener("abort", abort, { once: true });
      this.#removeAbort = () => signal.removeEventListener("abort", abort);
      if (signal.aborted)
        this.close();
    }
  }
  get closed() {
    return this.#closed;
  }
  async gpu(sessionId) {
    if (typeof sessionId !== "string" || !sessionId)
      throw new TypeError("gpu requires an attached target sessionId");
    const response = await this.send("Runtime.evaluate", {
      expression: `(async () => {
        if (!navigator.gpu) return { available: false, adapter: false, fallback: null, info: null };
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return { available: true, adapter: false, fallback: null, info: null };
        const info = adapter.info;
        return { available: true, adapter: true,
          fallback: typeof info?.isFallbackAdapter === "boolean" ? info.isFallbackAdapter : null,
          info: info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : null };
      })()`,
      awaitPromise: true,
      returnByValue: true
    }, sessionId);
    const { exceptionDetails } = response;
    if (exceptionDetails)
      throw new Error(exceptionDetails.text ?? "WebGPU probe failed");
    return response.result.value;
  }
  async send(method, params = {}, sessionId) {
    if (this.#closed)
      throw new Error("Chrome connection closed");
    if (typeof method !== "string" || !/^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/.test(method))
      throw new TypeError("CDP method must have Domain.command syntax");
    if (!params || typeof params !== "object" || Array.isArray(params))
      throw new TypeError("params must be an object");
    if (sessionId !== undefined && (typeof sessionId !== "string" || !sessionId))
      throw new TypeError("sessionId must be a nonempty string");
    const id = ++this.#nextId;
    const payload = JSON.stringify({
      id,
      method,
      params,
      ...sessionId === undefined ? {} : { sessionId }
    });
    if (this.#closed)
      throw new Error("Chrome connection closed");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, this.#timeout);
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.#socket.send(payload);
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }
  on(method, callback) {
    if (this.#closed)
      throw new Error("Chrome connection closed");
    if (typeof method !== "string" || !method.includes("."))
      throw new TypeError("event must have Domain.event syntax");
    if (typeof callback !== "function")
      throw new TypeError("callback must be a function");
    let listeners = this.#listeners.get(method);
    if (!listeners)
      this.#listeners.set(method, listeners = new Set);
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
      if (!listeners.size && this.#listeners.get(method) === listeners)
        this.#listeners.delete(method);
    };
  }
  #message(event) {
    let message;
    try {
      if (typeof event.data !== "string")
        throw new TypeError("CDP messages must be text");
      message = JSON.parse(event.data);
      if (!message || typeof message !== "object" || Array.isArray(message))
        throw new TypeError("invalid CDP message");
    } catch {
      this.close();
      return;
    }
    const { id, error: protocolError, method } = message;
    if (Number.isSafeInteger(id)) {
      const pending = this.#pending.get(id);
      if (!pending)
        return;
      this.#pending.delete(id);
      clearTimeout(pending.timer);
      if (protocolError) {
        const error = new Error(String(protocolError.message ?? "CDP command failed"));
        Object.assign(error, { code: protocolError.code, data: protocolError.data });
        pending.reject(error);
      } else
        pending.resolve(message.result);
    } else if (typeof method === "string") {
      const listeners = this.#listeners.get(method);
      if (listeners)
        for (const callback of Array.from(listeners)) {
          try {
            callback.call(undefined, message.params ?? {}, message.sessionId);
          } catch (error) {
            reportError(error);
          }
        }
    }
  }
  close() {
    if (this.#closed)
      return;
    this.#closed = true;
    this.#removeAbort?.();
    this.#listeners.clear();
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Chrome connection closed"));
    }
    this.#pending.clear();
    this.#socket.close();
  }
}
async function connect(endpoint, options = {}, launchDeadline) {
  const timeout = timeoutValue(options.timeout);
  let url = endpointURL(endpoint, true);
  options.signal?.throwIfAborted();
  const started = Date.now();
  if (url.startsWith("http:") || url.startsWith("https:")) {
    const deadline = AbortSignal.timeout(timeout);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    const response = await fetch(new URL("/json/version", url), { signal, redirect: "error", credentials: "omit" });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`CDP discovery failed: HTTP ${response.status}`);
    }
    const version = await response.json();
    if (!version || typeof version !== "object" || !("webSocketDebuggerUrl" in version) || typeof version.webSocketDebuggerUrl !== "string")
      throw new TypeError("CDP discovery returned no browser WebSocket endpoint");
    url = endpointURL(version.webSocketDebuggerUrl);
    signal.throwIfAborted();
  }
  const remaining = launchDeadline === undefined ? timeout - (Date.now() - started) : Math.ceil(launchDeadline - performance.now());
  if (remaining <= 0)
    throw new Error("CDP connection timed out");
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const signal = options.signal;
    const timer = setTimeout(() => fail(new Error("CDP connection timed out")), remaining);
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      socket.removeEventListener("error", error);
      socket.removeEventListener("close", closed);
      socket.removeEventListener("open", opened);
    };
    const fail = (reason) => {
      cleanup();
      socket.close();
      reject(reason);
    };
    const abort = () => fail(signal?.reason);
    const error = () => fail(new Error("CDP WebSocket connection failed"));
    const closed = () => fail(new Error("CDP WebSocket closed before opening"));
    const opened = () => {
      cleanup();
      const connection = new ChromiumConnection(socket, timeout, signal);
      if (connection.closed)
        reject(signal?.reason ?? new Error("Chrome connection closed"));
      else
        resolve(connection);
    };
    signal?.addEventListener("abort", abort, { once: true });
    socket.addEventListener("error", error, { once: true });
    socket.addEventListener("close", closed, { once: true });
    socket.addEventListener("open", opened, { once: true });
    if (signal?.aborted)
      abort();
  });
}
function findExecutable() {
  const configured = process.env.BUN_CHROMIUM_PATH ?? process.env.BUN_CHROME_PATH;
  if (configured)
    return Bun.which(configured);
  for (const name of ["chromium", "chromium-browser", "google-chrome", "chrome", "msedge"]) {
    const found = Bun.which(process.platform === "win32" ? `${name}.exe` : name);
    if (found)
      return found;
  }
  const candidates = process.platform === "win32" ? [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter((root) => typeof root === "string").flatMap((root) => [
    "BunChromium/Application/chrome.exe",
    "Chromium/Application/chrome.exe",
    "Google/Chrome/Application/chrome.exe",
    "Microsoft/Edge/Application/msedge.exe"
  ].map((name) => path.join(root, name))) : process.platform === "darwin" ? [
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ] : ["/usr/bin/chromium", "/usr/bin/google-chrome", "/snap/bin/chromium"];
  for (const candidate of candidates)
    if (Bun.which(candidate))
      return candidate;
  return null;
}
async function launch(options = {}) {
  const timeout = timeoutValue(options.timeout);
  options.signal?.throwIfAborted();
  const executable = options.executable ?? findExecutable();
  if (!executable || !Bun.which(executable))
    throw new Error("Chromium executable not found; set BUN_CHROMIUM_PATH or executable");
  const url = validateURL(options.url ?? "about:blank");
  const extensions = options.extensions ?? [];
  if (!Array.isArray(extensions) || extensions.some((dir) => typeof dir !== "string" || !path.isAbsolute(dir) || dir.includes(",") || dir.includes("\x00")))
    throw new TypeError("extensions must be absolute directory paths without commas or NUL");
  for (const dir of extensions) {
    chrome_manifests_default.validateExtension(JSON.parse(await Bun.file(path.join(dir, "manifest.json")).text()));
  }
  options.signal?.throwIfAborted();
  if (options.webgpu !== undefined && typeof options.webgpu !== "boolean")
    throw new TypeError("webgpu must be a boolean");
  const extraArgs = options.args ?? [];
  if (!Array.isArray(extraArgs) || extraArgs.some((arg) => typeof arg !== "string" || !/^--[a-z0-9][a-z0-9-]*(=[^\0\s]*)?$/.test(arg) || /^--(user-data-dir|remote-debugging-[a-z-]+|headless|load-extension|profile-directory|app)(=|$)/.test(arg)))
    throw new TypeError("args must be --switches that do not replace the profile, debugging endpoint, headless mode or URL");
  const linux = process.platform === "linux" ? linuxProcessGroup() : undefined;
  if (linux) {
    const probe = linux.pidfdOpen(process.pid);
    try {
      linux.pidfdSendSignal(probe, 0, linux.constants.PIDFD_SIGNAL_PROCESS_GROUP);
    } catch (error) {
      if (error.code !== "ESRCH")
        throw new Error("Chromium requires Linux 6.9 process-group pidfd signals", { cause: error });
    } finally {
      fs.closeSync(probe);
    }
  }
  const ownedProfile = options.userDataDir === undefined;
  if (!ownedProfile && (typeof options.userDataDir !== "string" || !path.isAbsolute(options.userDataDir)))
    throw new TypeError("userDataDir must be an absolute dedicated directory path");
  const userDataDir = ownedProfile ? fs.mkdtempSync(path.join(os.tmpdir(), "bun-chromium-")) : options.userDataDir;
  fs.mkdirSync(userDataDir, { recursive: true });
  const args = [
    executable,
    `--user-data-dir=${userDataDir}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check"
  ];
  if (options.headless === true)
    args.push("--headless=new");
  if (process.platform === "linux" && options.headless === true && ownedProfile)
    args.push("--password-store=basic");
  args.push(options.webgpu === false ? "--disable-features=WebGPUService" : "--enable-features=WebGPUService");
  if (extensions.length)
    args.push(`--load-extension=${extensions.join(",")}`);
  args.push(...extraArgs);
  args.push(url);
  let proc;
  let connection;
  let closed = false;
  let abort;
  let closing;
  let job;
  let pidfd = null;
  let processGroup = false;
  const running = (child) => child.exitCode === null;
  const waitForExit = async (child, milliseconds) => {
    let timer;
    try {
      return await Promise.race([
        child.exited.then(() => true),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), milliseconds);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const close = () => closing ??= (async () => {
    closed = true;
    if (abort)
      options.signal?.removeEventListener("abort", abort);
    try {
      if (proc && running(proc)) {
        if (connection && !connection.closed) {
          const request = connection.send("Browser.close").catch(() => {
            return;
          });
          if (!await waitForExit(proc, Math.min(timeout, 1000))) {
            connection.close();
            await request;
          }
        }
        if (running(proc)) {
          if (job)
            job.terminate();
          else if (pidfd === null || !processGroup)
            proc.kill("SIGKILL");
        }
      }
      if (linux && pidfd !== null && processGroup) {
        try {
          linux.pidfdSendSignal(pidfd, "SIGKILL", linux.constants.PIDFD_SIGNAL_PROCESS_GROUP);
        } catch (error) {
          if (error.code !== "ESRCH")
            throw error;
        }
      }
      if (proc && !await waitForExit(proc, Math.min(timeout, 5000)))
        throw new Error("Chromium did not exit after termination");
      connection?.close();
      job?.close();
      if (ownedProfile)
        fs.rmSync(userDataDir, { recursive: true, force: true });
    } finally {
      connection?.close();
      job?.close();
      if (pidfd !== null) {
        fs.closeSync(pidfd);
        pidfd = null;
      }
    }
  })();
  try {
    const spawnOptions = { stdin: "ignore", stdout: "ignore", stderr: "pipe" };
    job = process.platform === "win32" ? windowsJob() : undefined;
    if (job) {
      job.setLimits({ killOnClose: true });
      proc = job.spawn(args, spawnOptions);
    } else {
      proc = Bun.spawn(args, { ...spawnOptions, detached: process.platform === "linux" });
      if (linux) {
        pidfd = linux.pidfdForProcess(proc);
        if (pidfd === null)
          throw new Error("Chromium requires native subprocess pidfd support on Linux");
        linux.pidfdSendSignal(pidfd, 0, linux.constants.PIDFD_SIGNAL_PROCESS_GROUP);
        processGroup = true;
      }
    }
    if (!proc)
      throw new Error("Chromium spawn did not return a subprocess");
    const child = proc;
    const deadline = performance.now() + timeout;
    const remaining = () => Math.max(0, Math.ceil(deadline - performance.now()));
    const childExit = new AbortController;
    child.exited.then(() => childExit.abort(new Error("Chromium exited before connecting its debugging endpoint")));
    const launchSignal = options.signal ? AbortSignal.any([options.signal, childExit.signal]) : childExit.signal;
    const endpoint = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled)
          return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", cancelled);
        if (error !== undefined)
          reject(error);
        else
          resolve(value);
      };
      const timer = setTimeout(() => finish(new Error("Chromium debugging endpoint timed out")), remaining());
      const cancelled = () => finish(options.signal?.reason);
      options.signal?.addEventListener("abort", cancelled, { once: true });
      const drain = async () => {
        const reader = child.stderr.getReader();
        const decoder = new TextDecoder;
        let tail = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done)
              break;
            tail += decoder.decode(value, { stream: true });
            const match = /DevTools listening on (wss?:\/\/[^\s]+)[\r\n]/.exec(tail);
            if (match)
              finish(undefined, match[1]);
            tail = tail.slice(-16384);
          }
          finish(new Error("Chromium exited before publishing its debugging endpoint"));
        } catch (error) {
          finish(error);
        } finally {
          reader.releaseLock();
        }
      };
      drain();
      if (options.signal?.aborted)
        cancelled();
    });
    while (!connection) {
      launchSignal.throwIfAborted();
      const budget = remaining();
      if (budget === 0)
        throw new Error("Chromium debugging connection timed out");
      try {
        connection = await connect(endpoint, { ...options, timeout, signal: launchSignal }, deadline);
      } catch (error) {
        launchSignal.throwIfAborted();
        if (!(error instanceof Error) || !["CDP WebSocket connection failed", "CDP WebSocket closed before opening"].includes(error.message))
          throw error;
        await new Promise((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            launchSignal.removeEventListener("abort", abort);
            reject(launchSignal.reason);
          };
          const timer = setTimeout(() => {
            launchSignal.removeEventListener("abort", abort);
            resolve();
          }, Math.min(25, remaining()));
          launchSignal.addEventListener("abort", abort, { once: true });
          if (launchSignal.aborted)
            abort();
        });
      }
    }
    const backgroundClose = async () => {
      try {
        await close();
      } catch (error) {
        reportError(error);
      }
    };
    abort = () => {
      backgroundClose();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    const { signal } = options;
    if (signal?.aborted) {
      await close();
      signal.throwIfAborted();
    }
    const exited = async () => {
      await child.exited;
      if (!closed)
        await backgroundClose();
    };
    exited();
    return { connection, process: proc, endpoint, userDataDir, close, [Symbol.asyncDispose]: close };
  } catch (error) {
    await close();
    throw error;
  }
}
async function readProfileJSON(file) {
  const reader = Bun.file(file).stream().getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done)
        break;
      size += value.byteLength;
      if (size > 8 * 1024 * 1024)
        throw new RangeError("profile metadata exceeds the 8 MiB limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  try {
    return JSON.parse(await new Blob(chunks).text());
  } catch {
    throw new TypeError("profile metadata is not valid JSON");
  }
}
async function discoverProfiles(options = {}) {
  let directories = options.userDataDirs;
  if (directories === undefined) {
    const home = os.homedir();
    if (process.platform === "win32") {
      const local = process.env.LOCALAPPDATA;
      directories = local ? [path.join(local, "Google/Chrome/User Data"), path.join(local, "Chromium/User Data")] : [];
    } else if (process.platform === "darwin") {
      directories = [
        path.join(home, "Library/Application Support/Google/Chrome"),
        path.join(home, "Library/Application Support/Chromium")
      ];
    } else {
      const config = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
      directories = [path.join(config, "google-chrome"), path.join(config, "chromium")];
    }
  }
  if (!Array.isArray(directories) || directories.length > 16)
    throw new TypeError("userDataDirs must contain at most 16 absolute directory paths");
  const result = [];
  const seen = new Set;
  for (const directory of directories) {
    if (typeof directory !== "string" || !path.isAbsolute(directory))
      throw new TypeError("userDataDirs entries must be absolute paths");
    let root;
    try {
      root = await fs.promises.realpath(directory);
    } catch (error) {
      if (error.code === "ENOENT")
        continue;
      throw error;
    }
    if (seen.has(root))
      continue;
    seen.add(root);
    let state;
    try {
      state = await readProfileJSON(path.join(root, "Local State"));
    } catch (error) {
      if (error.code === "ENOENT")
        continue;
      throw error;
    }
    const cache = state?.profile?.info_cache;
    if (!cache || typeof cache !== "object" || Array.isArray(cache))
      continue;
    const names = Object.keys(cache);
    if (names.length > 256)
      throw new RangeError("profile metadata exceeds the 256 profile limit");
    for (const name of names) {
      if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\x00"))
        throw new TypeError("profile directory name must be a single path component");
      const profile = path.join(root, name);
      let info;
      try {
        info = await fs.promises.stat(profile);
      } catch (error) {
        if (error.code === "ENOENT")
          continue;
        throw error;
      }
      if (!info.isDirectory())
        continue;
      const resolved = await fs.promises.realpath(profile);
      if (path.dirname(resolved) !== root)
        throw new TypeError("profile directory must remain within its user data owner");
      result.push({
        userDataDir: root,
        directory: resolved,
        name: typeof cache[name]?.name === "string" ? cache[name].name : name,
        isDefault: name === "Default",
        isLastUsed: name === state.profile.last_used
      });
    }
  }
  return result;
}
function profileCapabilities() {
  return Object.freeze({
    discovery: "read-only-metadata",
    bookmarks: "read-only-file",
    storedCookies: "unavailable",
    storedPasswords: "unavailable",
    liveCookies: "requires-connected-browser-site-api",
    liveSessions: "requires-connected-browser-target-api"
  });
}
async function readBookmarks(file, options = {}) {
  if (typeof file !== "string" || !path.isAbsolute(file))
    throw new TypeError("Bookmarks file must be an absolute path");
  let hostname;
  const { site: siteOption } = options;
  if (siteOption !== undefined) {
    const site = new URL(siteOption);
    if (!["http:", "https:"].includes(site.protocol) || site.username || site.password)
      throw new TypeError("bookmark site must be an HTTP(S) URL without credentials");
    hostname = site.hostname;
  }
  if (options.includeSubdomains !== undefined && typeof options.includeSubdomains !== "boolean")
    throw new TypeError("includeSubdomains must be a boolean");
  const document = await readProfileJSON(file);
  if (!document || typeof document.roots !== "object" || !document.roots || Array.isArray(document.roots))
    throw new TypeError("invalid Chrome Bookmarks roots");
  const result = [];
  const stack = Object.values(document.roots).map((node) => ({
    node,
    folder: []
  }));
  let nodes = 0;
  while (stack.length) {
    if (++nodes > 1e5)
      throw new RangeError("Bookmarks exceeds the 100000 node limit");
    const { node, folder } = stack.pop();
    if (!node || typeof node.name !== "string")
      throw new TypeError("invalid bookmark node");
    if (node.type === "url") {
      if (typeof node.url !== "string" || typeof node.id !== "string")
        throw new TypeError("invalid bookmark URL node");
      if (hostname !== undefined) {
        let url;
        try {
          url = new URL(node.url);
        } catch {
          continue;
        }
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
          continue;
        if (url.hostname !== hostname && !(options.includeSubdomains && url.hostname.endsWith(`.${hostname}`)))
          continue;
      }
      result.push({ id: node.id, name: node.name, url: node.url, folder });
    } else if (node.type === "folder") {
      const { children } = node;
      if (!Array.isArray(children))
        throw new TypeError("invalid bookmark folder children");
      if (children.length + stack.length + nodes > 1e5)
        throw new RangeError("Bookmarks exceeds the 100000 node limit");
      const parent = [...folder, node.name];
      if (parent.length > 64)
        throw new RangeError("Bookmarks exceeds the 64 folder depth limit");
      for (let i = children.length - 1;i >= 0; i--)
        stack.push({ node: children[i], folder: parent });
    } else
      throw new TypeError("invalid bookmark folder node");
  }
  return result;
}
async function importSite(options) {
  if (!options || typeof options !== "object")
    throw new TypeError("site import requires options");
  for (const name of ["cookies", "sessions", "passwords", "includeSubdomains"]) {
    if (options[name] !== undefined && typeof options[name] !== "boolean")
      throw new TypeError(`${name} must be a boolean`);
  }
  if (options.passwords)
    throw new Error("Stored password import is unavailable");
  if (typeof options.source?.send !== "function" || typeof options.view?.cdp !== "function")
    throw new TypeError("site import requires explicit source and destination browser connections");
  let site;
  try {
    site = new URL(options.site);
  } catch {
    throw new TypeError("site must be an HTTP(S) URL without credentials");
  }
  if (!["http:", "https:"].includes(site.protocol) || site.username || site.password)
    throw new TypeError("site must be an HTTP(S) URL without credentials");
  if (options.navigate !== undefined && (typeof options.navigate !== "string" || !options.navigate))
    throw new TypeError("navigate must identify an explicitly selected source target");
  if (options.navigate !== undefined && options.sessions === false)
    throw new TypeError("selected target navigation requires sessions");
  if (options.navigate !== undefined && typeof options.view.navigate !== "function")
    throw new TypeError("destination browser must support navigation");
  if (options.sourceSessionId !== undefined && (typeof options.sourceSessionId !== "string" || !options.sourceSessionId))
    throw new TypeError("sourceSessionId must identify a connected source target session");
  options.signal?.throwIfAborted();
  let sourceTargets = [];
  if (options.sessions !== false || options.cookies !== false && options.sourceSessionId === undefined) {
    const response = await options.source.send("Target.getTargets");
    if (!Array.isArray(response.targetInfos) || response.targetInfos.length > 1e4)
      throw new Error("Source browser returned an invalid target list");
    sourceTargets = response.targetInfos.filter((target) => {
      if (target?.type !== "page" || typeof target.targetId !== "string" || typeof target.url !== "string")
        return false;
      try {
        const url = new URL(target.url);
        return ["http:", "https:"].includes(url.protocol) && url.origin === site.origin && !url.username && !url.password;
      } catch {
        return false;
      }
    });
  }
  const cookies = [];
  if (options.cookies !== false) {
    let sessionId = options.sourceSessionId;
    let attached;
    let response;
    try {
      if (sessionId === undefined) {
        const target = options.navigate === undefined ? sourceTargets[0] : sourceTargets.find((target) => target.targetId === options.navigate);
        if (!target)
          throw new Error("Site cookie import requires a connected source page on the selected origin");
        const attachment = await options.source.send("Target.attachToTarget", {
          targetId: target.targetId,
          flatten: true
        });
        if (typeof attachment.sessionId !== "string" || !attachment.sessionId)
          throw new Error("Source browser did not attach the selected site page");
        sessionId = attached = attachment.sessionId;
      }
      options.signal?.throwIfAborted();
      response = await options.source.send("Network.getCookies", { urls: [site.href] }, sessionId);
    } finally {
      if (attached)
        await options.source.send("Target.detachFromTarget", { sessionId: attached });
    }
    if (!Array.isArray(response.cookies) || response.cookies.length > 3000)
      throw new Error("Source browser returned an invalid site cookie list");
    for (const cookie of response.cookies) {
      if (!cookie || typeof cookie.name !== "string" || typeof cookie.value !== "string" || typeof cookie.domain !== "string" || typeof cookie.path !== "string" || !cookie.path.startsWith("/"))
        throw new Error("Source browser returned an invalid site cookie");
      const domain = cookie.domain.replace(/^\./, "").toLowerCase();
      if (!domain || !(site.hostname === domain || cookie.domain.startsWith(".") && site.hostname.endsWith(`.${domain}`)))
        throw new Error("Source browser returned a cookie outside the selected site");
      if (!site.pathname.startsWith(cookie.path) || site.pathname.length !== cookie.path.length && !cookie.path.endsWith("/") && site.pathname[cookie.path.length] !== "/")
        throw new Error("Source browser returned a cookie outside the selected site path");
      if (cookie.secure === true && site.protocol !== "https:")
        throw new Error("A secure source cookie cannot be imported for an HTTP site");
      const parameter = {
        name: cookie.name,
        value: cookie.value,
        url: site.origin + site.pathname,
        path: cookie.path
      };
      if (options.includeSubdomains && cookie.domain.startsWith("."))
        parameter.domain = `.${site.hostname}`;
      for (const name of ["secure", "httpOnly", "sameParty"]) {
        if (cookie[name] !== undefined) {
          if (typeof cookie[name] !== "boolean")
            throw new Error("Source cookie attributes are invalid");
          parameter[name] = cookie[name];
        }
      }
      for (const [name, allowed] of [
        ["sameSite", ["Strict", "Lax", "None"]],
        ["priority", ["Low", "Medium", "High"]],
        ["sourceScheme", ["Unset", "NonSecure", "Secure"]]
      ]) {
        if (cookie[name] !== undefined) {
          if (!allowed.includes(cookie[name]))
            throw new Error("Source cookie attributes are invalid");
          parameter[name] = cookie[name];
        }
      }
      const { expires, partitionKey } = cookie;
      if (cookie.session !== true && expires !== undefined) {
        if (typeof expires !== "number" || !Number.isFinite(expires))
          throw new Error("Source cookie expiry is invalid");
        if (expires >= 0)
          parameter.expires = expires;
      }
      if (cookie.partitionKeyOpaque === true)
        throw new Error("Opaque partitioned cookies cannot be imported");
      if (partitionKey !== undefined) {
        const key = partitionKey;
        if (!key || typeof key.topLevelSite !== "string" || typeof key.hasCrossSiteAncestor !== "boolean")
          throw new Error("Source cookie partition key is invalid");
        let topLevel;
        try {
          topLevel = new URL(key.topLevelSite);
        } catch {
          throw new Error("Source cookie partition key is invalid");
        }
        if (!["http:", "https:"].includes(topLevel.protocol) || topLevel.username || topLevel.password)
          throw new Error("Source cookie partition key is invalid");
        if (topLevel.origin !== site.origin || topLevel.pathname !== "/" || topLevel.search || topLevel.hash || key.hasCrossSiteAncestor)
          throw new Error("Source cookie partition does not match the selected first-party site");
        parameter.partitionKey = { topLevelSite: topLevel.origin, hasCrossSiteAncestor: false };
      }
      if (cookies.some((existing) => existing.name === parameter.name && existing.path === parameter.path && existing.domain === parameter.domain && JSON.stringify(existing.partitionKey) === JSON.stringify(parameter.partitionKey)))
        throw new Error("Source cookies collide after selected site scoping");
      cookies.push(parameter);
    }
  }
  const sessions = [];
  if (options.sessions !== false) {
    options.signal?.throwIfAborted();
    for (const target of sourceTargets) {
      if (target?.type !== "page" || typeof target.targetId !== "string" || typeof target.url !== "string")
        continue;
      let url;
      try {
        url = new URL(target.url);
      } catch {
        continue;
      }
      if (!["http:", "https:"].includes(url.protocol) || url.origin !== site.origin || url.username || url.password)
        continue;
      sessions.push({
        targetId: target.targetId,
        url: url.href,
        title: typeof target.title === "string" ? target.title : ""
      });
    }
  }
  const selected = options.navigate === undefined ? undefined : sessions.find((target) => target.targetId === options.navigate);
  if (options.navigate !== undefined && !selected)
    throw new Error("Selected source target is not a page on the requested site origin");
  options.signal?.throwIfAborted();
  if (cookies.length) {
    const acknowledgement = await options.view.cdp("Network.setCookies", { cookies });
    if (acknowledgement?.success === false)
      throw new Error("Destination browser rejected the site cookies");
    options.signal?.throwIfAborted();
    const verified = await options.view.cdp("Network.getCookies", {
      urls: [site.href]
    });
    if (!Array.isArray(verified?.cookies))
      throw new Error("Destination browser did not verify the site cookies");
    for (const cookie of cookies) {
      const expectedDomain = cookie.domain ?? site.hostname;
      const matches = verified.cookies.some((actual) => actual.name === cookie.name && actual.value === cookie.value && actual.domain === expectedDomain && actual.path === cookie.path && ["secure", "httpOnly", "sameSite"].every((name) => cookie[name] === undefined || actual[name] === cookie[name]) && (cookie.partitionKey === undefined ? actual.partitionKey === undefined : actual.partitionKey?.topLevelSite === cookie.partitionKey.topLevelSite && actual.partitionKey?.hasCrossSiteAncestor === false));
      if (!matches)
        throw new Error("Destination browser did not verify the site cookies");
    }
  }
  options.signal?.throwIfAborted();
  if (selected)
    await options.view.navigate(selected.url);
  return {
    site: site.origin,
    cookiesRequested: cookies.length,
    cookiesImported: cookies.length,
    sessions,
    navigated: !!selected
  };
}
function planApplication(options) {
  const url = validateURL(options.url);
  if (url === "about:blank")
    throw new TypeError("Profile applications require an HTTP(S) URL");
  for (const value of [options.executable, options.userDataDir]) {
    if (typeof value !== "string" || !(path.isAbsolute(value) || path.win32.isAbsolute(value)) || value.includes("\x00"))
      throw new TypeError("Application executable and user data directory must be absolute paths");
  }
  const profile = options.profileDirectory ?? "Default";
  if (typeof profile !== "string" || !profile || profile === "." || profile === ".." || /[\\/:\x00-\x1f]/.test(profile))
    throw new TypeError("Application profile must be a single directory name");
  return [
    options.executable,
    `--user-data-dir=${options.userDataDir}`,
    `--profile-directory=${profile}`,
    `--app=${url}`
  ];
}
async function openApplication(options) {
  if (!options || typeof options !== "object")
    throw new TypeError("Application options are required");
  const url = validateURL(options.url);
  if (url === "about:blank")
    throw new TypeError("Profile applications require an HTTP(S) URL");
  const browser = options.browser ?? "chrome";
  if (browser !== "chrome" && browser !== "chromium")
    throw new TypeError("browser must be chrome or chromium");
  const home = os.homedir();
  let userDataDir = options.userDataDir;
  if (userDataDir === undefined) {
    if (process.platform === "win32") {
      const local = process.env.LOCALAPPDATA;
      if (!local)
        throw new Error("Chrome user data owner is unavailable");
      userDataDir = path.join(local, browser === "chrome" ? "Google/Chrome/User Data" : "Chromium/User Data");
    } else if (process.platform === "darwin") {
      userDataDir = path.join(home, "Library/Application Support", browser === "chrome" ? "Google/Chrome" : "Chromium");
    } else {
      userDataDir = path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), browser === "chrome" ? "google-chrome" : "chromium");
    }
  }
  const profiles = await discoverProfiles({ userDataDirs: [userDataDir] });
  const preferred = profiles.find((profile) => profile.isLastUsed) ?? profiles.find((profile) => profile.isDefault);
  const profileDirectory = options.profileDirectory ?? (preferred ? path.basename(preferred.directory) : "Default");
  const profile = profiles.find((profile) => path.basename(profile.directory) === profileDirectory);
  if (!profile)
    throw new Error("Selected Chrome profile metadata is unavailable");
  let executable = options.executable;
  if (executable === undefined) {
    let candidates;
    if (process.platform === "win32") {
      const roots = [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
      candidates = roots.map((root) => path.join(root, browser === "chrome" ? "Google/Chrome/Application/chrome.exe" : "Chromium/Application/chrome.exe"));
    } else if (process.platform === "darwin") {
      candidates = [
        browser === "chrome" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/Applications/Chromium.app/Contents/MacOS/Chromium"
      ];
    } else {
      candidates = browser === "chrome" ? ["google-chrome-stable", "google-chrome"] : ["chromium", "chromium-browser"];
    }
    executable = candidates.map((candidate) => Bun.which(candidate)).find(Boolean) ?? undefined;
  }
  if (!executable)
    throw new Error("Selected browser executable is unavailable");
  const command = planApplication({ ...options, url, executable, userDataDir: profile.userDataDir, profileDirectory });
  const child = Bun.spawn(command, { detached: true, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  child.unref();
  return { pid: child.pid, browser, profileDirectory, mode: "native-profile-application" };
}
var chromium = {
  ChromiumConnection,
  connect,
  launch,
  findExecutable,
  manifests: chrome_manifests_default,
  profiles: {
    readBookmarks,
    discover: discoverProfiles,
    capabilities: profileCapabilities,
    importSite,
    planApplication,
    openApplication
  },
  protocol: { validateURL }
};
var { profiles, protocol } = chromium;

// src/server.ts
import { existsSync as existsSync5, mkdirSync as mkdirSync3, statSync as statSync3 } from "fs";
import { homedir as homedir4 } from "os";
import { extname, join as join9, normalize as normalize2, relative as relative4, resolve as resolve5, sep as sep2 } from "path";
var THREE_VERSION = "0.186.1";
var cacheRoot = () => resolve5(Bun.env.VIZ3D_CACHE ?? join9(homedir4(), ".cache", "aphrody", "viz3d"));
async function findThree() {
  const ok = (dir) => existsSync5(join9(dir, "build/three.webgpu.js")) && existsSync5(join9(dir, "examples/jsm"));
  if (Bun.env.VIZ3D_THREE_DIR && ok(Bun.env.VIZ3D_THREE_DIR))
    return resolve5(Bun.env.VIZ3D_THREE_DIR);
  for (const from of [process.cwd(), import.meta.dir]) {
    try {
      const dir = resolve5(Bun.resolveSync("three/package.json", from), "..");
      if (ok(dir) && dir.split(/[\\/]/).includes("node_modules"))
        return dir;
    } catch {}
  }
  const cache = join9(cacheRoot(), `three-${THREE_VERSION}`);
  const dir = join9(cache, "node_modules/three");
  if (!ok(dir)) {
    mkdirSync3(cache, { recursive: true });
    await Bun.write(join9(cache, "package.json"), JSON.stringify({ private: true, dependencies: { three: THREE_VERSION } }));
    const proc = Bun.spawnSync([process.execPath, "install", "--no-save"], { cwd: cache, stdout: "pipe", stderr: "pipe" });
    if (proc.exitCode !== 0 || !ok(dir))
      throw new Error(`could not install three@${THREE_VERSION}: ${proc.stderr.toString().trim()}`);
  }
  return dir;
}
var KIT_IMPORT_MAP = {
  imports: {
    three: "/three/build/three.webgpu.js",
    "three/webgpu": "/three/build/three.webgpu.js",
    "three/tsl": "/three/build/three.tsl.js",
    "three/addons/": "/three/examples/jsm/"
  }
};
var STUDY_IMPORT_MAP = {
  imports: { three: "/three/build/three.module.js", "three/addons/": "/three/examples/jsm/" }
};
var attr = (value) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
var html = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function tierAsset(record, tier) {
  const tiers = record.tiers ?? {};
  const asset = tiers[tier]?.asset ?? record.asset;
  return { asset, module: `../${asset.path.split("templates/kits/")[1]}` };
}
function surfaceSettings(record) {
  const tier = (record.tiers ?? {}).T2 ?? {};
  const ao = tier.ao ?? {};
  const seed = (record.params ?? []).find((p) => p.name === "seed")?.default ?? 1;
  return {
    families: tier.families ?? {},
    seed,
    size: tier.texture_budget?.resolution ?? 1024,
    ao: { samples: ao.samples ?? 13, radius_m: ao.radius_m ?? 0.45, ground_dirt_m: ao.ground_dirt_m ?? 0.6 }
  };
}
function blueprint(id) {
  const record = loadCatalog(undefined, "knowledge").records.find((r) => r.id === id);
  if (!record || record.knowledge_kind !== "blueprint")
    throw new Error(`${id}: unknown blueprint record`);
  return record;
}
function defaultParams(record) {
  return Object.fromEntries((record.params ?? []).map((p) => [p.name, p.default]));
}
async function kitPage(record, options = {}) {
  const { tier = "T1", capture = false, exportGlb = false, backend = "auto" } = options;
  const params = options.params ?? defaultParams(record);
  const template = await Bun.file(join9(runtimeDir(), "kit.html")).text();
  const { asset, module } = tierAsset(record, tier);
  const proof = record.proof ?? {};
  const meta = {
    blueprint: record.id,
    title: record.title.en,
    module,
    factory: asset.factory ?? "create",
    tier,
    params: JSON.stringify(params),
    footprint: JSON.stringify(record.footprint_m ?? null),
    backend
  };
  if (capture)
    meta.capture = "1";
  if (tier === "T2")
    meta.surface = JSON.stringify(surfaceSettings(record));
  if (proof.detail_socket)
    meta["detail-socket"] = proof.detail_socket;
  if (proof.max_close_m)
    meta["max-close-m"] = String(proof.max_close_m);
  const head = [
    `<script type="importmap">${JSON.stringify(KIT_IMPORT_MAP)}</script>`,
    ...Object.entries(meta).map(([name, content]) => `<meta name="${name}" content="${attr(content)}">`)
  ].join(`
    `);
  return template.replace("<!-- viz3d:inject -->", head).replace("{{title}}", html(record.title.en)).replace("/__viz3d/kit-viewer.js", exportGlb ? "/kits/_harness/export-glb.js" : "/__viz3d/kit-viewer.js");
}
async function indexPage() {
  const records = loadCatalog(undefined, "knowledge").records.filter((r) => r.knowledge_kind === "blueprint");
  const items = records.map((r) => `<li><a href="/kit/${r.id}/">${html(r.title.en)}</a> <a class="tier" href="/kit/${r.id}/?tier=T2">T2</a><p>${html(r.summary)}</p></li>`).join(`
`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>3Dviz Pro Max kits</title><link rel="stylesheet" href="/__viz3d/m3.css"><link rel="stylesheet" href="/__viz3d/kit.css"></head>
<body class="index"><main><h1>3Dviz Pro Max kits</h1><p>${records.length} blueprints on Three.js r${THREE_VERSION.split(".")[1]} WebGPU (WebGL2 fallback).</p><ul>${items}</ul></main></body></html>`;
}
function inside(root, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const target = normalize2(join9(root, rel));
  const back = relative4(root, target);
  if (back.startsWith("..") || back.split(sep2).includes(".."))
    return null;
  if (!existsSync5(target))
    return null;
  if (statSync3(target).isDirectory()) {
    const index = join9(target, "index.html");
    return existsSync5(index) ? index : null;
  }
  return target;
}
var NO_STORE = { "cache-control": "no-store" };
function fileResponse(path, extra = {}) {
  const type = extname(path) === ".glb" ? { "content-type": "model/gltf-binary" } : {};
  return new Response(Bun.file(path), { headers: { ...NO_STORE, ...type, ...extra } });
}
function withImportMap(page, map) {
  if (page.includes('type="importmap"'))
    return page;
  const tag = `<script type="importmap">${JSON.stringify(map)}</script>`;
  return page.includes("</head>") ? page.replace("</head>", `${tag}</head>`) : `${tag}${page}`;
}
async function assetResponse(key, studies) {
  const local = inside(join9(cacheRoot(), "assets"), key);
  if (local)
    return fileResponse(local);
  const manifest = await Bun.file(join9(studies, "assets-manifest.json")).json();
  if (!manifest.files.some((f) => f.key === key))
    return new Response("not found", { status: 404 });
  return Response.redirect(new URL(key, manifest.base).href, 302);
}
async function serve(options) {
  const three = await findThree();
  const runtime = runtimeDir();
  const kits = join9(skillRoot(), "templates/kits");
  const studies = options.mode === "study" ? studiesDir() : null;
  if (options.mode === "study" && !studies)
    throw new Error("the studies ship with the @aphrody/viz3d workspace package, not the skill");
  const dir = options.mode === "dir" ? resolve5(options.dir ?? ".") : null;
  if (dir && !existsSync5(dir))
    throw new Error(`no directory ${dir}`);
  const server = Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 0,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path === "/favicon.ico" && !(dir && inside(dir, path)))
        return new Response(null, { status: 204 });
      if (path.startsWith("/three/")) {
        const file = inside(three, path.slice("/three/".length));
        return file ? fileResponse(file) : new Response("not found", { status: 404 });
      }
      if (path.startsWith("/__viz3d/")) {
        const file = inside(runtime, path.slice("/__viz3d/".length));
        return file ? fileResponse(file) : new Response("not found", { status: 404 });
      }
      if (options.mode === "kit") {
        if (path === "/")
          return new Response(await indexPage(), { headers: { ...NO_STORE, "content-type": "text/html; charset=utf-8" } });
        if (path.startsWith("/kits/")) {
          const file = inside(kits, path.slice("/kits/".length));
          return file ? fileResponse(file) : new Response("not found", { status: 404 });
        }
        const match = /^\/kit\/([a-z0-9.-]+)\/?$/.exec(path);
        if (match) {
          try {
            const record = blueprint(match[1]);
            const params = url.searchParams.get("params");
            const page = await kitPage(record, {
              params: params ? JSON.parse(params) : null,
              tier: url.searchParams.get("tier") ?? "T1",
              capture: url.searchParams.get("capture") === "1",
              exportGlb: url.searchParams.get("export") === "1",
              backend: url.searchParams.get("backend") === "webgl2" ? "webgl2" : "auto"
            });
            return new Response(page, { headers: { ...NO_STORE, "content-type": "text/html; charset=utf-8" } });
          } catch (error) {
            return new Response(error.message, { status: 400 });
          }
        }
        return new Response("not found", { status: 404 });
      }
      if (studies) {
        if (path.startsWith("/assets/"))
          return assetResponse(decodeURIComponent(path.slice("/assets/".length)), studies);
        const file = inside(studies, path);
        if (!file)
          return new Response("not found", { status: 404 });
        if (file.endsWith(".html")) {
          const page = withImportMap(await Bun.file(file).text(), STUDY_IMPORT_MAP);
          return new Response(page, { headers: { ...NO_STORE, "content-type": "text/html; charset=utf-8" } });
        }
        return fileResponse(file);
      }
      const file = inside(dir, path);
      return file ? fileResponse(file) : new Response("not found", { status: 404 });
    }
  });
  return { url: `http://127.0.0.1:${server.port}/`, port: server.port, stop: () => server.stop(true) };
}
function kitUrl(base, id, query = {}) {
  const url = new URL(`kit/${id}/`, base);
  for (const [key, value] of Object.entries(query))
    if (value !== undefined)
      url.searchParams.set(key, value);
  return url.href;
}

// src/view-quality.ts
var THRESHOLDS = {
  dark_luma: 0.06,
  near_black_luma_mean: 0.04,
  near_black_dark_fraction: 0.85,
  flat_min_fraction: 0.3,
  flat_luma_gap: 0.25,
  wall_min_fraction: 0.2,
  wall_column_std: 0.03,
  low_contrast_luma_std: 0.04,
  grid_cols: 32,
  grid_rows: 18
};
var MEASURE_JS = `async ({dataUrl, t, region}) => {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const iw = image.naturalWidth, ih = image.naturalHeight;
  if (!iw || !ih) throw new Error('empty frame');
  const x0 = region ? Math.max(0, Math.round(region.x)) : 0;
  const y0 = region ? Math.max(0, Math.round(region.y)) : 0;
  const w = Math.max(1, Math.min(iw - x0, region ? Math.round(region.width) : iw));
  const h = Math.max(1, Math.min(ih - y0, region ? Math.round(region.height) : ih));
  const canvas = document.createElement('canvas');
  canvas.width = iw; canvas.height = ih;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  ctx.drawImage(image, 0, 0);
  const px = ctx.getImageData(x0, y0, w, h).data;
  const CX = t.grid_cols, CY = t.grid_rows, N = CX * CY;
  const sums = new Float64Array(N), counts = new Float64Array(N);
  let sum = 0, sumsq = 0, dark = 0;
  for (let y = 0; y < h; y++) {
    const row = Math.min(CY - 1, (y * CY / h) | 0) * CX;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const luma = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
      sum += luma; sumsq += luma * luma;
      if (luma < t.dark_luma) dark++;
      const k = row + Math.min(CX - 1, (x * CX / w) | 0);
      sums[k] += luma; counts[k]++;
    }
  }
  const n = w * h, mean = sum / n;
  const cell = new Float64Array(N);
  for (let k = 0; k < N; k++) cell[k] = counts[k] ? sums[k] / counts[k] : 0;
  const median = Array.from(cell).sort((a, b) => a - b)[N >> 1];
  // Largest 4-connected block of cells more than flat_luma_gap off the median, on either side:
  // a lit wall at the near plane, or an unlit one across a bright frame.
  let best = [];
  for (const sign of [1, -1]) {
    const off = (k) => sign > 0 ? cell[k] >= median + t.flat_luma_gap
                                : cell[k] <= median - t.flat_luma_gap;
    const seen = new Uint8Array(N);
    for (let start = 0; start < N; start++) {
      if (seen[start] || !off(start)) continue;
      const stack = [start], cluster = [];
      seen[start] = 1;
      while (stack.length) {
        const k = stack.pop(); cluster.push(k);
        const cx = k % CX, cy = (k / CX) | 0;
        for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
          if (nx < 0 || ny < 0 || nx >= CX || ny >= CY) continue;
          const j = ny * CX + nx;
          if (!seen[j] && off(j)) { seen[j] = 1; stack.push(j); }
        }
      }
      if (cluster.length > best.length) best = cluster;
    }
  }
  const inCluster = new Uint8Array(N);
  for (const k of best) inCluster[k] = 1;
  let clusterSum = 0, restSum = 0, restCount = 0;
  for (let k = 0; k < N; k++) {
    if (inCluster[k]) clusterSum += cell[k]; else { restSum += cell[k]; restCount++; }
  }
  // Longest run of adjacent columns with no vertical structure, and how far that band sits
  // from the columns around it: the signature of a wall standing across the near plane.
  const colMean = [], colFlat = [];
  for (let cx = 0; cx < CX; cx++) {
    let s = 0, q = 0;
    for (let cy = 0; cy < CY; cy++) { const v = cell[cy * CX + cx]; s += v; q += v * v; }
    const m = s / CY;
    colMean.push(m);
    colFlat.push(Math.sqrt(Math.max(0, q / CY - m * m)) < t.wall_column_std);
  }
  let band = {length: 0, start: 0}, run = 0;
  for (let cx = 0; cx < CX; cx++) {
    run = colFlat[cx] ? run + 1 : 0;
    if (run > band.length) band = {length: run, start: cx - run + 1};
  }
  let bandSum = 0, outSum = 0, outCount = 0;
  for (let cx = 0; cx < CX; cx++) {
    if (cx >= band.start && cx < band.start + band.length) bandSum += colMean[cx];
    else { outSum += colMean[cx]; outCount++; }
  }
  const r = (v) => Math.round(v * 10000) / 10000;
  return {
    region: {x: x0, y: y0, width: w, height: h},
    wall_fraction: r(band.length / CX),
    wall_columns: band.length,
    wall_luma: band.length ? r(bandSum / band.length) : null,
    wall_rest_luma: outCount ? r(outSum / outCount) : null,
    luma_mean: r(mean),
    luma_std: r(Math.sqrt(Math.max(0, sumsq / n - mean * mean))),
    luma_median_cell: r(median),
    dark_fraction: r(dark / n),
    flat_fraction: r(best.length / N),
    flat_cells: best.length,
    flat_luma: best.length ? r(clusterSum / best.length) : null,
    rest_luma: restCount ? r(restSum / restCount) : null
  };
}`;
var CANVAS_REGION_JS = `() => {
  const canvases = document.querySelectorAll('canvas');
  if (canvases.length !== 1) return null;
  const r = canvases[0].getBoundingClientRect();
  return r.width >= 64 && r.height >= 64
    ? {x: r.x, y: r.y, width: r.width, height: r.height} : null;
}`;
function gap(stats, key, restKey) {
  const region = stats[key];
  const rest = stats[restKey];
  return region != null && rest != null ? Math.abs(region - rest) : 0;
}
function classify(stats, t = THRESHOLDS) {
  if (stats.luma_mean < t.near_black_luma_mean || stats.dark_fraction > t.near_black_dark_fraction)
    return [false, "near-black"];
  const block = stats.flat_fraction > t.flat_min_fraction && gap(stats, "flat_luma", "rest_luma") > t.flat_luma_gap;
  const wall = (stats.wall_fraction ?? 0) > t.wall_min_fraction && gap(stats, "wall_luma", "wall_rest_luma") > t.flat_luma_gap;
  if (block || wall)
    return [false, "flat-occluder"];
  if (stats.luma_std < t.low_contrast_luma_std)
    return [false, "low-contrast"];
  return [true, "usable"];
}
async function canvasRegion(page) {
  try {
    return await page.evaluate(`(${CANVAS_REGION_JS})()`);
  } catch {
    return null;
  }
}
async function measurePng(page, png, region = null, t = THRESHOLDS) {
  const dataUrl = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
  try {
    const stats = await page.evaluate(`(${MEASURE_JS})(${JSON.stringify({ dataUrl, t, region })})`);
    const [usable, reason] = classify(stats, t);
    return { ...stats, measured: true, usable, reason };
  } catch (error) {
    return { measured: false, usable: null, reason: "not-measured", error: String(error.message ?? error).slice(0, 200) };
  }
}
function unusable(views) {
  return views.filter((v) => v.view_quality?.usable === false).map((v) => v.name);
}

// src/capture.ts
var ANGLE_ARGS = {
  darwin: ["--use-angle=metal"],
  linux: ["--use-angle=gl", "--ignore-gpu-blocklist"],
  win32: ["--use-angle=d3d11"]
};
var RENDERER_JS = `(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
})()`;
var WEBGPU_JS = `(async () => {
  if (!navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter().catch(() => null);
  if (!adapter) return null;
  const info = adapter.info || {};
  return { vendor: info.vendor || '', architecture: info.architecture || '', description: info.description || '',
           fallback: Boolean(adapter.isFallbackAdapter || info.isFallbackAdapter) };
})()`;
function captureMode(renderer) {
  if (!renderer)
    return "unknown";
  return /swiftshader/i.test(renderer) ? "swiftshader" : "gpu";
}
var slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "target";
var now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");

class CdpPage {
  browser;
  sessionId;
  targetId;
  consoleErrors = [];
  pageErrors = [];
  off = [];
  constructor(browser, sessionId, targetId) {
    this.browser = browser;
    this.sessionId = sessionId;
    this.targetId = targetId;
  }
  static async open(browser, width, height) {
    const { targetId } = await browser.connection.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await browser.connection.send("Target.attachToTarget", { targetId, flatten: true });
    const page = new CdpPage(browser, sessionId, targetId);
    const on = (event, fn) => page.off.push(browser.connection.on(event, (params, sid) => sid === sessionId && fn(params)));
    on("Runtime.consoleAPICalled", (p) => {
      if (p.type === "error")
        page.consoleErrors.push((p.args ?? []).map((a) => a.value ?? a.description ?? a.unserializableValue ?? "").join(" "));
    });
    on("Runtime.exceptionThrown", (p) => {
      const d = p.exceptionDetails ?? {};
      page.pageErrors.push(d.exception?.description ?? d.text ?? "exception");
    });
    on("Log.entryAdded", (p) => {
      if (p.entry?.level === "error" && p.entry.source !== "violation")
        page.consoleErrors.push(p.entry.text);
    });
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Log.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    return page;
  }
  send(method, params = {}) {
    return this.browser.connection.send(method, params, this.sessionId);
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "evaluation failed");
    return r.result.value;
  }
  async goto(url, timeoutMs) {
    const loaded = new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`navigation timed out: ${url}`)), timeoutMs);
      const off = this.browser.connection.on("Page.loadEventFired", (_p, sid) => {
        if (sid !== this.sessionId)
          return;
        clearTimeout(timer);
        off();
        done();
      });
    });
    const r = await this.send("Page.navigate", { url });
    if (r.errorText)
      throw new Error(`navigation failed: ${r.errorText}`);
    await loaded;
  }
  async waitFor(expression, timeoutMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await this.evaluate(`Boolean(${expression})`).catch(() => false))
        return true;
      await Bun.sleep(50);
    }
    return false;
  }
  async screenshot(format, quality, fullPage = false) {
    const params = { format };
    if (format === "jpeg" && quality !== undefined)
      params.quality = quality;
    if (fullPage) {
      const metrics = await this.send("Page.getLayoutMetrics");
      params.captureBeyondViewport = true;
      params.clip = { x: 0, y: 0, width: metrics.cssContentSize.width, height: metrics.cssContentSize.height, scale: 1 };
    }
    const { data } = await this.send("Page.captureScreenshot", params);
    return Buffer.from(data, "base64");
  }
  async click(selector, timeoutMs) {
    const box = JSON.stringify(selector);
    const found = await this.waitFor(`document.querySelector(${box})`, timeoutMs);
    if (!found)
      throw new Error(`no element matches ${selector}`);
    const point = await this.evaluate(`(() => {
      const el = document.querySelector(${box}); el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
      await this.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
  }
  close() {
    for (const off of this.off)
      off();
  }
}
var CAPTURE_HELP = `usage: capture.js (--dir DIR [--path REL/] [--query K=V] | --url URL | --kit RECORD-ID [--tier T1|T2|T3]
                  [--params JSON] [--backend auto|webgl2]) [--out captures] [--view NAME]... [--all-views]
                  [--click CSS]... [--width 1280] [--height 720] [--ready-flag __sceneReady|none] [--settle-ms 300]
                  [--motion-check MS [--expect-motion]] [--expect-usable] [--timeout-s 30] [--allow-console-errors]
                  [--full-page] [--gpu] [--format png|jpeg] [--quality N] [--browser PATH]
Capture screenshots of a locally served scene through headless Chrome, Chromium or Edge (CDP); records
observations, never judges them. Exit: 0 ok, 1 console/page errors, 2 usage, 3 no browser, 4 ready timeout,
5 frozen with --expect-motion, 6 unusable view with --expect-usable.`;
function parseCaptureArgs(argv) {
  const { values } = parse(argv, {
    dir: { type: "string" },
    url: { type: "string" },
    kit: { type: "string" },
    tier: { type: "string" },
    params: { type: "string" },
    backend: { type: "string" },
    path: { type: "string" },
    out: { type: "string" },
    view: { type: "string", multiple: true },
    "all-views": { type: "boolean" },
    click: { type: "string", multiple: true },
    width: { type: "string" },
    height: { type: "string" },
    "ready-flag": { type: "string" },
    "settle-ms": { type: "string" },
    "motion-check": { type: "string" },
    "expect-motion": { type: "boolean" },
    "expect-usable": { type: "boolean" },
    "timeout-s": { type: "string" },
    "allow-console-errors": { type: "boolean" },
    "full-page": { type: "boolean" },
    query: { type: "string" },
    gpu: { type: "boolean" },
    format: { type: "string" },
    quality: { type: "string" },
    browser: { type: "string" }
  });
  if (values.help)
    return null;
  const int = (name, fallback) => {
    const raw = values[name];
    if (raw === undefined)
      return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n))
      throw new UsageError(`--${name}: invalid int value '${raw}'`);
    return n;
  };
  const format = values.format ?? "png";
  if (format !== "png" && format !== "jpeg")
    throw new UsageError("--format: choose from png, jpeg");
  const backend = values.backend ?? "auto";
  if (backend !== "auto" && backend !== "webgl2")
    throw new UsageError("--backend: choose from auto, webgl2");
  const quality = values.quality === undefined ? undefined : int("quality", 0);
  return {
    directory: values.dir,
    url: values.url,
    kit: values.kit,
    kitTier: values.tier,
    kitParams: values.params,
    kitBackend: backend,
    path: values.path ?? "",
    out: values.out ?? "captures",
    views: values.view ?? [],
    allViews: Boolean(values["all-views"]),
    clicks: values.click ?? [],
    width: int("width", 1280),
    height: int("height", 720),
    readyFlag: values["ready-flag"] ?? "__sceneReady",
    settleMs: int("settle-ms", 300),
    motionCheck: int("motion-check", 0),
    expectMotion: Boolean(values["expect-motion"]),
    expectUsable: Boolean(values["expect-usable"]),
    timeoutS: int("timeout-s", 30),
    allowConsoleErrors: Boolean(values["allow-console-errors"]),
    fullPage: Boolean(values["full-page"]),
    query: values.query ?? "",
    gpu: Boolean(values.gpu),
    format,
    quality,
    executable: values.browser
  };
}
function resolveTarget(args) {
  const targets = [args.directory, args.url, args.kit].filter(Boolean).length;
  if (targets !== 1)
    throw new UsageError("Pass exactly one of --dir, --url or --kit");
  if (!args.directory && args.path)
    throw new UsageError("--path is only valid with --dir");
  if (!args.kit && (args.kitTier || args.kitParams))
    throw new UsageError("--tier and --params are only valid with --kit");
  if (args.directory) {
    const p = args.path;
    if (p.startsWith("/") || p.includes("\\") || p.split("/").includes("..") || p.includes("?") || p.includes("#"))
      throw new UsageError("--path must be a relative URL path without traversal, query or fragment");
    let page = join10(args.directory, ...p.split("/").filter(Boolean));
    if (p.endsWith("/") || !/\.[^/]+$/.test(p))
      page = join10(page, "index.html");
    if (!Bun.file(page).size)
      throw new UsageError(`No page for --path ${p || "/"} in ${args.directory}`);
  }
  if (args.kit) {
    try {
      blueprint(args.kit);
    } catch (error) {
      throw new UsageError(error.message);
    }
    if (args.kitParams) {
      try {
        JSON.parse(args.kitParams);
      } catch {
        throw new UsageError("--params must be a JSON object");
      }
    }
  }
}
function loggedDir(directory) {
  if (!directory)
    return null;
  const rel = relative5(process.cwd(), resolve6(directory)).replaceAll("\\", "/");
  return /^[a-zA-Z]:/.test(rel) ? resolve6(directory).split(/[\\/]/).pop() ?? null : rel || ".";
}
async function capture(args) {
  resolveTarget(args);
  const executable = args.executable ?? findExecutable();
  if (!executable)
    return { status: 3, log: {}, message: "No Chrome, Chromium or Edge found. Set BUN_CHROMIUM_PATH or pass --browser." };
  let server = null;
  let url = args.url ?? "";
  if (args.directory) {
    server = await serve({ mode: "dir", dir: args.directory });
    url = server.url + encodeURI(args.path.replace(/^\/+/, "")) + (args.query ? `?${args.query.replace(/^\?/, "")}` : "");
  } else if (args.kit) {
    server = await serve({ mode: "kit" });
    url = kitUrl(server.url, args.kit, {
      capture: "1",
      tier: args.kitTier,
      params: args.kitParams,
      backend: args.kitBackend === "webgl2" ? "webgl2" : undefined
    });
  }
  const out = resolve6(args.out);
  mkdirSync4(out, { recursive: true });
  const log = {
    url,
    dir: loggedDir(args.directory),
    kit: args.kit ?? null,
    viewport: { width: args.width, height: args.height },
    ready_flag: args.readyFlag,
    ready_timeout: false,
    motion: null,
    gpu_requested: args.gpu,
    capture_mode: "unknown",
    webgl_renderer: null,
    webgpu_adapter: null,
    scene_backend: null,
    image_format: args.format,
    views: [],
    clicks: [],
    unusable_views: [],
    view_quality_thresholds: THRESHOLDS,
    measured_region: null,
    console_errors: [],
    page_errors: [],
    started: now(),
    finished: null,
    browser: null
  };
  let status = 0;
  let browser = null;
  let page = null;
  try {
    browser = await launch({
      executable,
      headless: true,
      webgpu: true,
      timeout: args.timeoutS * 1000,
      args: [...args.gpu ? ANGLE_ARGS[process.platform] ?? [] : [], "--hide-scrollbars", "--mute-audio"]
    });
    log.browser = (await browser.connection.send("Browser.getVersion") ?? {}).product ?? null;
    page = await CdpPage.open(browser, args.width, args.height);
    const shoot = async (name) => {
      const bytes = await page.screenshot(args.format, args.quality, args.fullPage);
      const file = `${name}.${args.format === "jpeg" ? "jpg" : "png"}`;
      writeFileSync(join10(out, file), bytes);
      return { entry: { name, file, sha256: sha256(bytes) }, bytes };
    };
    const measure = async (bytes) => {
      const png = args.format === "png" ? bytes : await page.screenshot("png", undefined, args.fullPage);
      return measurePng(page, png, log.measured_region);
    };
    status = await (async () => {
      await page.goto(url, args.timeoutS * 1000);
      log.webgl_renderer = await page.evaluate(RENDERER_JS).catch(() => null);
      log.capture_mode = captureMode(log.webgl_renderer);
      log.webgpu_adapter = await page.evaluate(WEBGPU_JS).catch(() => null);
      if (args.readyFlag !== "none") {
        if (!await page.waitFor(`window.${args.readyFlag} === true`, args.timeoutS * 1000)) {
          log.ready_timeout = true;
          return 4;
        }
      }
      await Bun.sleep(args.settleMs);
      log.scene_backend = await page.evaluate("window.__kitInfo?.backend ?? null").catch(() => null);
      if (args.kit)
        log.kit_info = await page.evaluate("window.__kitInfo ?? null").catch(() => null);
      log.measured_region = await canvasRegion(page);
      const first = await shoot("default");
      first.entry.view_quality = await measure(first.bytes);
      log.views.push(first.entry);
      if (args.motionCheck) {
        await Bun.sleep(args.motionCheck);
        const after = await shoot("default-motion");
        after.entry.view_quality = await measure(after.bytes);
        log.views.push(after.entry);
        log.motion = {
          interval_ms: args.motionCheck,
          differs: first.entry.sha256 !== after.entry.sha256,
          sha_before: first.entry.sha256,
          sha_after: after.entry.sha256
        };
      }
      const names = [...args.views];
      if (args.allViews) {
        for (const n of await page.evaluate("window.__viewer?.views ?? []"))
          if (!names.includes(n))
            names.push(n);
      }
      for (const name of names) {
        const applied = await page.evaluate(`Boolean(window.__viewer && window.__viewer.setView(${JSON.stringify(name)}))`);
        await Bun.sleep(args.settleMs);
        const shot = await shoot(slug(name));
        shot.entry.requested = name;
        shot.entry.applied = applied;
        shot.entry.view_quality = await measure(shot.bytes);
        log.views.push(shot.entry);
      }
      for (const [index, selector] of args.clicks.entries()) {
        await page.click(selector, args.timeoutS * 1000);
        await Bun.sleep(args.settleMs);
        const shot = await shoot(`click-${index}-${slug(selector)}`);
        log.clicks.push({ selector, file: shot.entry.file, sha256: shot.entry.sha256 });
      }
      return 0;
    })();
  } finally {
    if (page) {
      log.console_errors = page.consoleErrors;
      log.page_errors = page.pageErrors;
      page.close();
    }
    await browser?.close().catch(() => {
      return;
    });
    server?.stop();
  }
  log.finished = now();
  log.unusable_views = unusable(log.views.filter((v) => v.name !== "default-motion"));
  writeFileSync(join10(out, "capture-log.json"), `${JSON.stringify(log, null, 2)}
`);
  const errors = [...log.console_errors, ...log.page_errors];
  if (status === 4)
    return { status, log, message: `Ready flag window.${args.readyFlag} never became true` };
  if (errors.length && !args.allowConsoleErrors)
    return { status: 1, log, message: `${errors.length} console or page errors; see ${join10(out, "capture-log.json")}` };
  if (log.motion && args.expectMotion && !log.motion.differs)
    return { status: 5, log, message: `Frames ${log.motion.interval_ms} ms apart are identical; the scene is frozen` };
  if (log.unusable_views.length && args.expectUsable)
    return { status: 6, log, message: `unusable views: ${JSON.stringify(log.unusable_views)}` };
  return {
    status,
    log,
    message: `${log.views.length} view captures, ${log.clicks.length} click captures in ${out}; capture_mode ${log.capture_mode} ` + `(${log.webgl_renderer ?? "no WebGL2 context"})${log.scene_backend ? `; scene backend ${log.scene_backend}` : ""}`
  };
}
async function captureCommand(argv) {
  let args;
  try {
    args = parseCaptureArgs(argv);
    if (!args) {
      console.log(CAPTURE_HELP);
      return 0;
    }
    const result = await capture(args);
    if (result.log.motion)
      console.log(`motion: ${JSON.stringify(result.log.motion)}`);
    (result.status === 0 ? console.log : console.error)(result.message);
    return result.status;
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`Usage: ${error.message}`);
      return 2;
    }
    throw error;
  }
}

// src/hero-tier.ts
import { copyFileSync, existsSync as existsSync6, mkdirSync as mkdirSync5, mkdtempSync as mkdtempSync2, readFileSync as readFileSync4, rmSync as rmSync2, statSync as statSync4 } from "fs";
import { tmpdir as tmpdir2 } from "os";
import { dirname as dirname4, join as join11, relative as relative6, resolve as resolve7 } from "path";
var CACHE = ".cache/hero-tier";
var keyJson = (value) => pyDumps(value, { sortKeys: true, ensureAscii: true, separators: [",", ":"] });
var blenderScript = (skill) => join11(skill, "templates/kits/blender/export-hero-tier.py");
var pipelineFiles = (skill) => [blenderScript(skill), join11(skill, "templates/kits/_harness/export-glb.js")];
function paramsHash(module, params, bake) {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(module);
  hasher.update(keyJson(params));
  hasher.update(keyJson(bake));
  return hasher.digest("hex").slice(0, 12);
}
function pipelineHash(skill) {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const path of pipelineFiles(skill))
    hasher.update(existsSync6(path) ? readFileSync4(path) : path.split(/[\\/]/).pop() ?? "");
  return hasher.digest("hex").slice(0, 12);
}
function heroRecord(root, id) {
  const record = loadCatalog(root, "knowledge").records.find((r) => r.id === id);
  if (!record || record.knowledge_kind !== "blueprint")
    throw new UsageError(`${id}: unknown blueprint record`);
  return record;
}
function checkOutPath(out, project, cacheDir) {
  const target = resolve7(out);
  const within = (root) => {
    const rel = relative6(resolve7(root), target);
    return rel === "" || !rel.startsWith("..") && !/^[a-zA-Z]:/.test(rel);
  };
  if (!within(project) && !within(cacheDir))
    throw new UsageError(`--out must stay inside ${project} or ${cacheDir}, not ${target}`);
  return target;
}
async function exportT1(record, params, target, timeoutS) {
  const executable = findExecutable();
  if (!executable)
    throw new Error("no Chrome, Chromium or Edge to run the export page; pass --t1-glb instead");
  const server = await serve({ mode: "kit" });
  const browser = await launch({ executable, headless: true, webgpu: true, timeout: timeoutS * 1000 });
  try {
    const page = await CdpPage.open(browser, 640, 480);
    try {
      await page.goto(kitUrl(server.url, record.id, { export: "1", capture: "1", params: JSON.stringify(params) }), timeoutS * 1000);
      if (!await page.waitFor("window.__kitExportReady === true", timeoutS * 1000))
        throw new Error("export page never finished");
      const failure = await page.evaluate("window.__kitExportError ?? null");
      if (failure)
        throw new Error(`export failed: ${failure.split(`
`)[0]}`);
      const glb = await page.evaluate("window.__kitGlb");
      await Bun.write(target, Buffer.from(glb, "base64"));
      return target;
    } finally {
      page.close();
    }
  } finally {
    await browser.close().catch(() => {
      return;
    });
    server.stop();
  }
}
async function runBlender2(binary, skill, source, target, bake, families, timeoutS) {
  const number = (v) => v instanceof PyFloat ? pyFloatRepr(v.value) : String(v);
  const command = [
    ...process.platform !== "win32" && Bun.which("nice") ? ["nice", "-n", "10"] : [],
    binary,
    "-b",
    "--factory-startup",
    "--python-exit-code",
    "1",
    "--threads",
    "4",
    "--python",
    blenderScript(skill),
    "--",
    "--in",
    source,
    "--out",
    target,
    "--families",
    keyJson(families),
    "--seed",
    String(bake.seed),
    "--bake-size",
    String(bake.bake_size),
    "--quality",
    String(bake.quality),
    "--ao-samples",
    String(bake.ao_samples),
    "--ao-strength",
    number(bake.ao_strength),
    "--bevel",
    number(bake.bevel_m)
  ];
  const started = performance.now();
  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe", windowsHide: true, detached: process.platform === "linux" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      if (process.platform === "linux")
        process.kill(-proc.pid, "SIGKILL");
      else
        proc.kill("SIGKILL");
    } catch {
      proc.kill("SIGKILL");
    }
  }, timeoutS * 1000);
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  const seconds = Math.round((performance.now() - started) / 10) / 100;
  if (timedOut) {
    rmSync2(target, { force: true });
    return { status: "timeout", detail: {}, seconds };
  }
  const output = `${stdout}
${stderr}`;
  if (code !== 0 || !existsSync6(target)) {
    rmSync2(target, { force: true });
    return { status: "failed", detail: { stderr: output.trim().split(/\r?\n/).slice(-6) }, seconds };
  }
  const line = stdout.split(/\r?\n/).find((l) => l.startsWith("HERO "));
  return { status: "produced", detail: line ? JSON.parse(line.slice(5)) : {}, seconds };
}
var HERO_TIER_HELP = `usage: hero-tier.js --record ID --out PATH [--params JSON] [--root DIR] [--skill DIR] [--cache-dir DIR]
                    [--t1-glb PATH] [--host host.json] [--timeout-s 120] [--bake-size 1024] [--ao-samples 64]
                    [--ao-strength 0.8] [--quality 85] [--bevel M] [--no-hero-tier]
Bake one blueprint's T3 hero: kit module -> GLB -> Blender -> cached hero GLB. Exit 0 produced, cached,
unavailable, skipped or timed out; 1 Blender failed; 2 usage.`;
async function heroTier(argv) {
  const { values } = parse(argv, {
    record: { type: "string" },
    out: { type: "string" },
    params: { type: "string" },
    root: { type: "string" },
    skill: { type: "string" },
    "cache-dir": { type: "string" },
    "t1-glb": { type: "string" },
    host: { type: "string" },
    "timeout-s": { type: "string" },
    "bake-size": { type: "string" },
    "ao-samples": { type: "string" },
    "ao-strength": { type: "string" },
    quality: { type: "string" },
    bevel: { type: "string" },
    "no-hero-tier": { type: "boolean" }
  });
  if (values.help)
    return { code: 0, summary: HERO_TIER_HELP };
  if (!values.record || !values.out)
    throw new UsageError(HERO_TIER_HELP);
  const num = (name, fallback, integer = true) => {
    const raw = values[name];
    if (raw === undefined)
      return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || integer && !Number.isInteger(n))
      throw new UsageError(`--${name}: invalid value '${raw}'`);
    return n;
  };
  const project = resolve7(values.root ?? process.cwd());
  const skill = resolve7(values.skill ?? skillRoot());
  const cacheDir = resolve7(values["cache-dir"] ?? join11(project, CACHE));
  const record = heroRecord(skill, values.record);
  const out = checkOutPath(values.out, project, cacheDir);
  let exactParams;
  try {
    exactParams = values.params ? parseLossless(values.params) : Object.fromEntries(lossless(record).params.map((p) => [p.name, p.default]));
  } catch (error) {
    throw new UsageError(`--params: ${error.message}`);
  }
  const params = plain(exactParams);
  const summary = { record: record.id, out, cache: "miss" };
  if (values["no-hero-tier"])
    return { code: 0, summary: { ...summary, status: "skipped", note: "--no-hero-tier: the ceiling stays at the highest runtime tier" } };
  const defaults = lossless(record).defaults?.values ?? {};
  const bake = {
    bake_size: num("bake-size", 1024),
    ao_samples: num("ao-samples", 64),
    ao_strength: new PyFloat(num("ao-strength", 0.8, false)),
    quality: num("quality", 85),
    bevel_m: values.bevel !== undefined ? new PyFloat(num("bevel", 0, false)) : defaults.bevel_m ?? new PyFloat(0.012),
    seed: Math.trunc(Number(params.seed ?? 1)),
    pipeline: pipelineHash(skill)
  };
  const module = join11(skill, record.asset.path);
  const digest = paramsHash(readFileSync4(module), exactParams, bake);
  Object.assign(summary, { params_hash: digest, params, bake: plain(bake) });
  const cached = join11(cacheDir, `${digest}.glb`);
  if (existsSync6(cached)) {
    mkdirSync5(dirname4(out), { recursive: true });
    if (resolve7(cached) !== out)
      copyFileSync(cached, out);
    return { code: 0, summary: { ...summary, status: "cached", cache: "hit", bytes: statSync4(out).size, seconds: 0 } };
  }
  const blender = values.host ? (() => {
    const found = JSON.parse(readFileSync4(values.host, "utf8")).blender ?? {};
    return { found: Boolean(found.found), path: found.path ?? null, version: found.version ?? null, source: "host probe file" };
  })() : await findBlender2();
  if (!blender.found || !blender.path)
    return { code: 0, summary: { ...summary, status: "unavailable", blender: null, note: `no Blender: ${blender.source}; the ceiling stays at T2` } };
  const families = lossless(record).tiers?.T2?.families ?? {};
  const folder = mkdtempSync2(join11(tmpdir2(), "viz3d-hero-"));
  try {
    const source = values["t1-glb"] ? resolve7(values["t1-glb"]) : join11(folder, "kit-t1.glb");
    const target = join11(folder, "hero-t3.glb");
    try {
      if (!values["t1-glb"])
        await exportT1(record, params, source, num("timeout-s", 120));
    } catch (error) {
      return { code: 0, summary: { ...summary, status: "unavailable", note: error.message } };
    }
    const { status, detail, seconds } = await runBlender2(blender.path, skill, source, target, bake, families, num("timeout-s", 120));
    if (status === "produced") {
      mkdirSync5(cacheDir, { recursive: true });
      copyFileSync(target, cached);
      mkdirSync5(dirname4(out), { recursive: true });
      copyFileSync(target, out);
    }
    Object.assign(summary, { status, seconds, blender: blender.version, detail });
    if (status === "produced")
      summary.bytes = statSync4(out).size;
    return { code: status === "failed" ? 1 : 0, summary };
  } finally {
    rmSync2(folder, { recursive: true, force: true });
  }
}
async function heroTierCommand(argv) {
  try {
    const { code, summary } = await heroTier(argv);
    console.log(typeof summary === "string" ? summary : JSON.stringify(summary));
    return code;
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`Usage: ${error.message}`);
      return 2;
    }
    throw error;
  }
}

// src/host-probe.ts
import { mkdirSync as mkdirSync6, writeFileSync as writeFileSync2 } from "fs";
import { arch, cpus, release, totalmem } from "os";
import { basename as basename2, dirname as dirname5 } from "path";
var SCHEMA_VERSION = 1;
var TIMEOUT_MS = 5000;
var SYSTEM = { darwin: "Darwin", linux: "Linux", win32: "Windows" };
var now2 = () => new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
async function run2(command, timeoutMs = TIMEOUT_MS) {
  if (!Bun.which(command[0]))
    return null;
  try {
    const proc = Bun.spawn(command, { stdout: "pipe", stderr: "ignore", timeout: timeoutMs, windowsHide: true });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return code === 0 ? out.trim() : null;
  } catch {
    return null;
  }
}
var firstLine = (text) => text ? text.split(/\r?\n/)[0]?.trim() ?? null : null;
async function gpuDarwin() {
  const source = "system_profiler SPDisplaysDataType -json";
  try {
    const cards = JSON.parse(await run2(["system_profiler", "SPDisplaysDataType", "-json"]) ?? "").SPDisplaysDataType;
    if (!cards?.length)
      return { found: false, source: `${source} listed no display device` };
    const card = cards[0];
    const cores = String(card.sppci_cores ?? "");
    return {
      found: true,
      name: card.sppci_model ?? card._name,
      vendor: card.spdisplays_vendor ?? null,
      cores: /^\d+$/.test(cores) ? Number(cores) : null,
      source
    };
  } catch {
    return { found: false, source: `${source} unavailable` };
  }
}
async function gpuLinux() {
  const name = firstLine(await run2(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"]));
  if (name)
    return { found: true, name, vendor: "NVIDIA", cores: null, source: "nvidia-smi --query-gpu=name" };
  const line = (await run2(["lspci"]) ?? "").split(`
`).find((l) => l.toUpperCase().includes("VGA"));
  if (line)
    return { found: true, name: line.split(": ").slice(1).join(": ").trim() || line, vendor: null, cores: null, source: "lspci (VGA lines)" };
  return { found: false, source: "nvidia-smi and lspci unavailable" };
}
async function gpuWindows() {
  const key = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}";
  const text = await run2(["reg", "query", key, "/s", "/v", "DriverDesc"]);
  const names = [...(text ?? "").matchAll(/DriverDesc\s+REG_SZ\s+(.+)/g)].map((m) => m[1].trim());
  const name = names.find((n) => !/basic (display|render)|virtual|remote/i.test(n)) ?? names[0];
  if (name)
    return { found: true, name, vendor: null, cores: null, source: "reg query <display class> /s /v DriverDesc" };
  return { found: false, source: "reg query <display class> unavailable" };
}
function gpuInfo(system) {
  if (system === "Darwin")
    return gpuDarwin();
  if (system === "Linux")
    return gpuLinux();
  if (system === "Windows")
    return gpuWindows();
  return Promise.resolve({ found: false, source: `no GPU probe for ${system}` });
}
function browserInfo() {
  const executable = (() => {
    try {
      return findExecutable();
    } catch {
      return null;
    }
  })();
  if (!executable)
    return { found: false, name: null, source: "no Chrome, Chromium or Edge on BUN_CHROMIUM_PATH, PATH or install paths" };
  const name = basename2(executable).replace(/\.exe$/i, "");
  const kind = /msedge/i.test(name) ? "edge" : /chromium/i.test(executable) ? "chromium" : "chrome";
  return { found: true, name: kind, source: "@aphrody/chromium findExecutable" };
}
function ceiling(blender) {
  if (blender.found && blender.meets_minimum)
    return ["T3", `Blender ${blender.version} >= 4.2 found via ${blender.source}`];
  if (blender.found)
    return ["T2", `Blender ${blender.version} is older than 4.2 LTS, so the T3 bake pipeline is not supported`];
  return ["T2", `no runnable Blender (${blender.source}), so no T3 bake`];
}
function captureMode2(system, hasBrowser) {
  if (!hasBrowser)
    return ["unavailable", "no CDP browser was found, so no automated capture"];
  return [
    "swiftshader",
    `${system}: headless capture defaults to the software renderer; --gpu requests the ANGLE backend ` + "and the capture log names the renderer that actually drew"
  ];
}
async function probe(platform = process.platform) {
  const system = SYSTEM[platform] ?? platform;
  const blender = await findBlender2();
  const [quality, qualityReason] = ceiling(blender);
  const browser = browserInfo();
  const [mode, modeReason] = captureMode2(system, browser.found);
  const memory = totalmem();
  return {
    schema_version: SCHEMA_VERSION,
    probed_at: now2(),
    os: { system, release: release(), product_version: system === "Darwin" ? firstLine(await run2(["sw_vers", "-productVersion"])) : null, arch: arch() },
    cpu: { brand: cpus()[0]?.model?.trim() ?? null, logical_cores: cpus().length },
    memory_gb: memory ? Math.round(memory / 1024 ** 3 * 10) / 10 : null,
    gpu: await gpuInfo(system),
    blender,
    runtimes: {
      bun: Bun.version,
      bun_revision: Bun.revision.slice(0, 9),
      node: firstLine(await run2(["node", "--version"]))?.replace(/^v/, "") ?? null,
      browser
    },
    quality_ceiling: quality,
    quality_ceiling_reason: qualityReason,
    quality_ceiling_scope: "shipped-kit-pipelines",
    quality_note: "Tool discovery does not grade art, constrain custom/sourced geometry, " + "or prove that a bake, render or scientific model was executed.",
    capture_mode_expected: mode,
    capture_mode_reason: modeReason
  };
}
var HOST_PROBE_HELP = `usage: host-probe.js [--out host.json]
Discover host tools and recommend available shipped-kit pipelines, without grading art.`;
async function hostProbeCommand(argv) {
  const { values } = parse(argv, { out: { type: "string" } });
  if (values.help)
    return HOST_PROBE_HELP;
  const report = await probe();
  if (values.out) {
    mkdirSync6(dirname5(values.out), { recursive: true });
    writeFileSync2(values.out, `${JSON.stringify(report, null, 2)}
`);
  }
  return report;
}

// src/serve-command.ts
var SERVE_HELP = `usage: serve.js (--kit [RECORD-ID] [--tier T1|T2|T3] | --dir DIR | --study [ID]) [--port N]
Serve kit blueprints (Three.js WebGPU, WebGL2 fallback, M3 chrome), a built scene directory, or the upstream
studies on 127.0.0.1 with Bun.serve, and print the URL. Ctrl+C stops it.`;
async function serveCommand(argv) {
  const { values, positionals } = parse(argv, {
    kit: { type: "boolean" },
    dir: { type: "string" },
    study: { type: "boolean" },
    tier: { type: "string" },
    port: { type: "string" }
  });
  if (values.help) {
    console.log(SERVE_HELP);
    return 0;
  }
  const modes = [values.kit, values.dir, values.study].filter(Boolean).length;
  if (modes !== 1)
    throw new UsageError(SERVE_HELP);
  const port = values.port === undefined ? 0 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new UsageError(`--port: invalid value '${values.port}'`);
  const mode = values.kit ? "kit" : values.study ? "study" : "dir";
  const [target] = positionals;
  if (mode === "kit" && target)
    blueprint(target);
  const server = await serve({ mode, dir: values.dir, port });
  const url = mode === "kit" && target ? kitUrl(server.url, target, { tier: values.tier }) : mode === "study" && target ? new URL(`${target}/`, server.url).href : server.url;
  console.log(url);
  await new Promise((done) => {
    process.on("SIGINT", () => done());
    process.on("SIGTERM", () => done());
  });
  server.stop();
  return 0;
}

// src/validate.ts
var import__2020 = __toESM(require__2020(), 1);
var import_ajv_formats = __toESM(require_dist(), 1);
import { readFileSync as readFileSync5 } from "fs";
import { join as join12 } from "path";
function validateDataset(root = skillRoot()) {
  const errors = [];
  const schema = (name) => JSON.parse(readFileSync5(join12(root, "schemas", `${name}.schema.json`), "utf8"));
  const ajv = new import__2020.default({ allErrors: true, strict: false });
  import_ajv_formats.default(ajv);
  const check = (validator, value, label) => {
    if (!validator(value))
      for (const e of validator.errors ?? [])
        errors.push(`${label}${e.instancePath}: ${e.message}${e.params ? ` ${JSON.stringify(e.params)}` : ""}`);
  };
  const names = ["recipe", "knowledge", "source", "direction", "evidence-event"];
  for (const name of names)
    ajv.addSchema(schema(name), `${name}.schema.json`);
  const compiled = (name) => ajv.getSchema(`${name}.schema.json`);
  const catalog = loadCatalog(root, "all");
  const recipe = compiled("recipe");
  const knowledge = compiled("knowledge");
  const source = compiled("source");
  const direction = compiled("direction");
  const byKind = {};
  for (const { _path, ...record } of catalog.records) {
    if (record.id.startsWith("recipe."))
      check(recipe, record, record.id);
    else {
      check(knowledge, record, record.id);
      byKind[record.knowledge_kind ?? "?"] = (byKind[record.knowledge_kind ?? "?"] ?? 0) + 1;
    }
  }
  for (const s of catalog.sources)
    check(source, s, `source ${s.id}`);
  const directions = JSON.parse(readFileSync5(join12(root, "data/directions.json"), "utf8"));
  for (const d of directions)
    check(direction, d, `direction ${d.id}`);
  const ids = new Set(catalog.records.map((r) => r.id));
  const sourceIds = new Set(catalog.sources.map((s) => s.id));
  const directionIds = new Set(directions.map((d) => d.id));
  for (const r of catalog.records) {
    for (const rel of r.related_ids ?? [])
      if (!ids.has(rel))
        errors.push(`${r.id}: dangling related_ids ${rel}`);
    for (const c of r.claims ?? [])
      for (const ref of c.source_refs ?? [])
        if (!sourceIds.has(ref.source_id))
          errors.push(`${r.id}: unknown source ${ref.source_id}`);
    for (const d of r.direction_ids ?? [])
      if (!directionIds.has(d))
        errors.push(`${r.id}: unknown direction ${d}`);
  }
  const summary = JSON.parse(readFileSync5(join12(root, "data/catalog-summary.json"), "utf8"));
  const hashes = { catalog_hash: fingerprint(catalog.manifest, catalog.records), ...catalogHashes(catalog.records) };
  const recipes = catalog.records.filter((r) => r.id.startsWith("recipe.")).length;
  const match = summary.catalog_hash === hashes.catalog_hash && summary.content_catalog_hash === hashes.content_catalog_hash && summary.layout_hash === hashes.layout_hash;
  if (!match)
    errors.push("data/catalog-summary.json hashes do not match the records");
  if (summary.recipes !== recipes || summary.knowledge !== catalog.records.length - recipes)
    errors.push("data/catalog-summary.json counts do not match the records");
  return {
    ok: errors.length === 0,
    counts: {
      recipes,
      knowledge: catalog.records.length - recipes,
      blueprints: byKind.blueprint ?? 0,
      sources: catalog.sources.length,
      directions: directions.length
    },
    knowledge_by_kind: Object.fromEntries(Object.entries(byKind).sort()),
    hashes: { ...hashes, match_summary: match },
    errors
  };
}
var VALIDATE_HELP = `usage: validate.js [--skill DIR]
Validate the manifest, the record layout and every record, source and direction against schemas/ (JSON Schema
2020-12), plus relationships, source references and the catalog-summary hashes. Exit 1 when anything fails.`;
function validateCommand(argv) {
  const { values } = parse(argv, { skill: { type: "string" } });
  if (values.help)
    return { code: 0, report: VALIDATE_HELP };
  const report = validateDataset(values.skill ?? skillRoot());
  return { code: report.ok ? 0 : 1, report };
}

// src/cli.ts
var HELP = `usage: viz3d <command> [options]   (each command takes --help)

  search <query>          lexical BM25 candidates over recipes and knowledge
  resolve <id>...         full records, cited sources and blueprint snippets
  context <objective>     design context: candidate groups, blueprints, quality brief (design-context)
  probe [--out host.json] host tools and the shipped-kit quality ceiling (host-probe)
  blender                 locate a runnable Blender (blender-locate)
  hero-tier --record ID   bake a blueprint's T3 hero GLB with Blender, cached
  serve --kit|--dir|--study  Bun.serve scene server (WebGPU kits, built scenes, the 37 studies)
  capture ...             CDP screenshots of a served scene, view quality, motion check
  validate                manifest, layout, JSON Schema and hash checks of the dataset
  fetch-assets            download the study anatomy meshes into the local cache`;
var json = (value) => console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
async function run(argv) {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "search":
        return json(searchCommand(rest)), 0;
      case "resolve":
        return json(resolveCommand(rest)), 0;
      case "context":
      case "design-context":
        return json(contextCommand(rest)), 0;
      case "probe":
      case "host-probe":
        return json(await hostProbeCommand(rest)), 0;
      case "blender":
      case "blender-locate":
        return json(await findBlender2()), 0;
      case "hero-tier":
        return await heroTierCommand(rest);
      case "serve":
        return await serveCommand(rest);
      case "capture":
        return await captureCommand(rest);
      case "validate": {
        const { code, report } = validateCommand(rest);
        json(report);
        return code;
      }
      case "fetch-assets":
        return await fetchAssetsCommand(rest);
      case undefined:
      case "help":
      case "--help":
      case "-h":
        return json(HELP), 0;
      default:
        console.error(`unknown command ${command}

${HELP}`);
        return 2;
    }
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }
}
if (false)
  ;

export { run };
