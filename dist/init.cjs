#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/ajv/dist/compile/codegen/code.js
var require_code = __commonJS({
  "node_modules/ajv/dist/compile/codegen/code.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.regexpCode = exports2.getEsmExportName = exports2.getProperty = exports2.safeStringify = exports2.stringify = exports2.strConcat = exports2.addCodeArg = exports2.str = exports2._ = exports2.nil = exports2._Code = exports2.Name = exports2.IDENTIFIER = exports2._CodeOrName = void 0;
    var _CodeOrName = class {
    };
    exports2._CodeOrName = _CodeOrName;
    exports2.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;
    var Name = class extends _CodeOrName {
      constructor(s) {
        super();
        if (!exports2.IDENTIFIER.test(s))
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
    };
    exports2.Name = Name;
    var _Code = class extends _CodeOrName {
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
        return (_a = this._str) !== null && _a !== void 0 ? _a : this._str = this._items.reduce((s, c) => `${s}${c}`, "");
      }
      get names() {
        var _a;
        return (_a = this._names) !== null && _a !== void 0 ? _a : this._names = this._items.reduce((names, c) => {
          if (c instanceof Name)
            names[c.str] = (names[c.str] || 0) + 1;
          return names;
        }, {});
      }
    };
    exports2._Code = _Code;
    exports2.nil = new _Code("");
    function _(strs, ...args) {
      const code = [strs[0]];
      let i = 0;
      while (i < args.length) {
        addCodeArg(code, args[i]);
        code.push(strs[++i]);
      }
      return new _Code(code);
    }
    exports2._ = _;
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
    exports2.str = str;
    function addCodeArg(code, arg) {
      if (arg instanceof _Code)
        code.push(...arg._items);
      else if (arg instanceof Name)
        code.push(arg);
      else
        code.push(interpolate(arg));
    }
    exports2.addCodeArg = addCodeArg;
    function optimize(expr) {
      let i = 1;
      while (i < expr.length - 1) {
        if (expr[i] === plus) {
          const res = mergeExprItems(expr[i - 1], expr[i + 1]);
          if (res !== void 0) {
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
    exports2.strConcat = strConcat;
    function interpolate(x) {
      return typeof x == "number" || typeof x == "boolean" || x === null ? x : safeStringify(Array.isArray(x) ? x.join(",") : x);
    }
    function stringify(x) {
      return new _Code(safeStringify(x));
    }
    exports2.stringify = stringify;
    function safeStringify(x) {
      return JSON.stringify(x).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    }
    exports2.safeStringify = safeStringify;
    function getProperty(key) {
      return typeof key == "string" && exports2.IDENTIFIER.test(key) ? new _Code(`.${key}`) : _`[${key}]`;
    }
    exports2.getProperty = getProperty;
    function getEsmExportName(key) {
      if (typeof key == "string" && exports2.IDENTIFIER.test(key)) {
        return new _Code(`${key}`);
      }
      throw new Error(`CodeGen: invalid export name: ${key}, use explicit $id name mapping`);
    }
    exports2.getEsmExportName = getEsmExportName;
    function regexpCode(rx) {
      return new _Code(rx.toString());
    }
    exports2.regexpCode = regexpCode;
  }
});

// node_modules/ajv/dist/compile/codegen/scope.js
var require_scope = __commonJS({
  "node_modules/ajv/dist/compile/codegen/scope.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.ValueScope = exports2.ValueScopeName = exports2.Scope = exports2.varKinds = exports2.UsedValueState = void 0;
    var code_1 = require_code();
    var ValueError = class extends Error {
      constructor(name) {
        super(`CodeGen: "code" for ${name} not defined`);
        this.value = name.value;
      }
    };
    var UsedValueState;
    (function(UsedValueState2) {
      UsedValueState2[UsedValueState2["Started"] = 0] = "Started";
      UsedValueState2[UsedValueState2["Completed"] = 1] = "Completed";
    })(UsedValueState || (exports2.UsedValueState = UsedValueState = {}));
    exports2.varKinds = {
      const: new code_1.Name("const"),
      let: new code_1.Name("let"),
      var: new code_1.Name("var")
    };
    var Scope = class {
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
        if (((_b = (_a = this._parent) === null || _a === void 0 ? void 0 : _a._prefixes) === null || _b === void 0 ? void 0 : _b.has(prefix)) || this._prefixes && !this._prefixes.has(prefix)) {
          throw new Error(`CodeGen: prefix "${prefix}" is not allowed in this scope`);
        }
        return this._names[prefix] = { prefix, index: 0 };
      }
    };
    exports2.Scope = Scope;
    var ValueScopeName = class extends code_1.Name {
      constructor(prefix, nameStr) {
        super(nameStr);
        this.prefix = prefix;
      }
      setValue(value, { property, itemIndex }) {
        this.value = value;
        this.scopePath = (0, code_1._)`.${new code_1.Name(property)}[${itemIndex}]`;
      }
    };
    exports2.ValueScopeName = ValueScopeName;
    var line = (0, code_1._)`\n`;
    var ValueScope = class extends Scope {
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
        if (value.ref === void 0)
          throw new Error("CodeGen: ref must be passed in value");
        const name = this.toName(nameOrPrefix);
        const { prefix } = name;
        const valueKey = (_a = value.key) !== null && _a !== void 0 ? _a : value.ref;
        let vs = this._values[prefix];
        if (vs) {
          const _name = vs.get(valueKey);
          if (_name)
            return _name;
        } else {
          vs = this._values[prefix] = /* @__PURE__ */ new Map();
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
          if (name.scopePath === void 0)
            throw new Error(`CodeGen: name "${name}" has no value`);
          return (0, code_1._)`${scopeName}${name.scopePath}`;
        });
      }
      scopeCode(values = this._values, usedValues, getCode) {
        return this._reduceValues(values, (name) => {
          if (name.value === void 0)
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
          const nameSet = usedValues[prefix] = usedValues[prefix] || /* @__PURE__ */ new Map();
          vs.forEach((name) => {
            if (nameSet.has(name))
              return;
            nameSet.set(name, UsedValueState.Started);
            let c = valueCode(name);
            if (c) {
              const def = this.opts.es5 ? exports2.varKinds.var : exports2.varKinds.const;
              code = (0, code_1._)`${code}${def} ${name} = ${c};${this.opts._n}`;
            } else if (c = getCode === null || getCode === void 0 ? void 0 : getCode(name)) {
              code = (0, code_1._)`${code}${c}${this.opts._n}`;
            } else {
              throw new ValueError(name);
            }
            nameSet.set(name, UsedValueState.Completed);
          });
        }
        return code;
      }
    };
    exports2.ValueScope = ValueScope;
  }
});

// node_modules/ajv/dist/compile/codegen/index.js
var require_codegen = __commonJS({
  "node_modules/ajv/dist/compile/codegen/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.or = exports2.and = exports2.not = exports2.CodeGen = exports2.operators = exports2.varKinds = exports2.ValueScopeName = exports2.ValueScope = exports2.Scope = exports2.Name = exports2.regexpCode = exports2.stringify = exports2.getProperty = exports2.nil = exports2.strConcat = exports2.str = exports2._ = void 0;
    var code_1 = require_code();
    var scope_1 = require_scope();
    var code_2 = require_code();
    Object.defineProperty(exports2, "_", { enumerable: true, get: function() {
      return code_2._;
    } });
    Object.defineProperty(exports2, "str", { enumerable: true, get: function() {
      return code_2.str;
    } });
    Object.defineProperty(exports2, "strConcat", { enumerable: true, get: function() {
      return code_2.strConcat;
    } });
    Object.defineProperty(exports2, "nil", { enumerable: true, get: function() {
      return code_2.nil;
    } });
    Object.defineProperty(exports2, "getProperty", { enumerable: true, get: function() {
      return code_2.getProperty;
    } });
    Object.defineProperty(exports2, "stringify", { enumerable: true, get: function() {
      return code_2.stringify;
    } });
    Object.defineProperty(exports2, "regexpCode", { enumerable: true, get: function() {
      return code_2.regexpCode;
    } });
    Object.defineProperty(exports2, "Name", { enumerable: true, get: function() {
      return code_2.Name;
    } });
    var scope_2 = require_scope();
    Object.defineProperty(exports2, "Scope", { enumerable: true, get: function() {
      return scope_2.Scope;
    } });
    Object.defineProperty(exports2, "ValueScope", { enumerable: true, get: function() {
      return scope_2.ValueScope;
    } });
    Object.defineProperty(exports2, "ValueScopeName", { enumerable: true, get: function() {
      return scope_2.ValueScopeName;
    } });
    Object.defineProperty(exports2, "varKinds", { enumerable: true, get: function() {
      return scope_2.varKinds;
    } });
    exports2.operators = {
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
    var Node = class {
      optimizeNodes() {
        return this;
      }
      optimizeNames(_names, _constants) {
        return this;
      }
    };
    var Def = class extends Node {
      constructor(varKind, name, rhs) {
        super();
        this.varKind = varKind;
        this.name = name;
        this.rhs = rhs;
      }
      render({ es5, _n }) {
        const varKind = es5 ? scope_1.varKinds.var : this.varKind;
        const rhs = this.rhs === void 0 ? "" : ` = ${this.rhs}`;
        return `${varKind} ${this.name}${rhs};` + _n;
      }
      optimizeNames(names, constants3) {
        if (!names[this.name.str])
          return;
        if (this.rhs)
          this.rhs = optimizeExpr(this.rhs, names, constants3);
        return this;
      }
      get names() {
        return this.rhs instanceof code_1._CodeOrName ? this.rhs.names : {};
      }
    };
    var Assign = class extends Node {
      constructor(lhs, rhs, sideEffects) {
        super();
        this.lhs = lhs;
        this.rhs = rhs;
        this.sideEffects = sideEffects;
      }
      render({ _n }) {
        return `${this.lhs} = ${this.rhs};` + _n;
      }
      optimizeNames(names, constants3) {
        if (this.lhs instanceof code_1.Name && !names[this.lhs.str] && !this.sideEffects)
          return;
        this.rhs = optimizeExpr(this.rhs, names, constants3);
        return this;
      }
      get names() {
        const names = this.lhs instanceof code_1.Name ? {} : { ...this.lhs.names };
        return addExprNames(names, this.rhs);
      }
    };
    var AssignOp = class extends Assign {
      constructor(lhs, op, rhs, sideEffects) {
        super(lhs, rhs, sideEffects);
        this.op = op;
      }
      render({ _n }) {
        return `${this.lhs} ${this.op}= ${this.rhs};` + _n;
      }
    };
    var Label = class extends Node {
      constructor(label) {
        super();
        this.label = label;
        this.names = {};
      }
      render({ _n }) {
        return `${this.label}:` + _n;
      }
    };
    var Break = class extends Node {
      constructor(label) {
        super();
        this.label = label;
        this.names = {};
      }
      render({ _n }) {
        const label = this.label ? ` ${this.label}` : "";
        return `break${label};` + _n;
      }
    };
    var Throw = class extends Node {
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
    };
    var AnyCode = class extends Node {
      constructor(code) {
        super();
        this.code = code;
      }
      render({ _n }) {
        return `${this.code};` + _n;
      }
      optimizeNodes() {
        return `${this.code}` ? this : void 0;
      }
      optimizeNames(names, constants3) {
        this.code = optimizeExpr(this.code, names, constants3);
        return this;
      }
      get names() {
        return this.code instanceof code_1._CodeOrName ? this.code.names : {};
      }
    };
    var ParentNode = class extends Node {
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
        return nodes.length > 0 ? this : void 0;
      }
      optimizeNames(names, constants3) {
        const { nodes } = this;
        let i = nodes.length;
        while (i--) {
          const n = nodes[i];
          if (n.optimizeNames(names, constants3))
            continue;
          subtractNames(names, n.names);
          nodes.splice(i, 1);
        }
        return nodes.length > 0 ? this : void 0;
      }
      get names() {
        return this.nodes.reduce((names, n) => addNames(names, n.names), {});
      }
    };
    var BlockNode = class extends ParentNode {
      render(opts) {
        return "{" + opts._n + super.render(opts) + "}" + opts._n;
      }
    };
    var Root = class extends ParentNode {
    };
    var Else = class extends BlockNode {
    };
    Else.kind = "else";
    var If = class _If extends BlockNode {
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
            return e instanceof _If ? e : e.nodes;
          if (this.nodes.length)
            return this;
          return new _If(not(cond), e instanceof _If ? [e] : e.nodes);
        }
        if (cond === false || !this.nodes.length)
          return void 0;
        return this;
      }
      optimizeNames(names, constants3) {
        var _a;
        this.else = (_a = this.else) === null || _a === void 0 ? void 0 : _a.optimizeNames(names, constants3);
        if (!(super.optimizeNames(names, constants3) || this.else))
          return;
        this.condition = optimizeExpr(this.condition, names, constants3);
        return this;
      }
      get names() {
        const names = super.names;
        addExprNames(names, this.condition);
        if (this.else)
          addNames(names, this.else.names);
        return names;
      }
    };
    If.kind = "if";
    var For = class extends BlockNode {
    };
    For.kind = "for";
    var ForLoop = class extends For {
      constructor(iteration) {
        super();
        this.iteration = iteration;
      }
      render(opts) {
        return `for(${this.iteration})` + super.render(opts);
      }
      optimizeNames(names, constants3) {
        if (!super.optimizeNames(names, constants3))
          return;
        this.iteration = optimizeExpr(this.iteration, names, constants3);
        return this;
      }
      get names() {
        return addNames(super.names, this.iteration.names);
      }
    };
    var ForRange = class extends For {
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
    };
    var ForIter = class extends For {
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
      optimizeNames(names, constants3) {
        if (!super.optimizeNames(names, constants3))
          return;
        this.iterable = optimizeExpr(this.iterable, names, constants3);
        return this;
      }
      get names() {
        return addNames(super.names, this.iterable.names);
      }
    };
    var Func = class extends BlockNode {
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
    };
    Func.kind = "func";
    var Return = class extends ParentNode {
      render(opts) {
        return "return " + super.render(opts);
      }
    };
    Return.kind = "return";
    var Try = class extends BlockNode {
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
        (_a = this.catch) === null || _a === void 0 ? void 0 : _a.optimizeNodes();
        (_b = this.finally) === null || _b === void 0 ? void 0 : _b.optimizeNodes();
        return this;
      }
      optimizeNames(names, constants3) {
        var _a, _b;
        super.optimizeNames(names, constants3);
        (_a = this.catch) === null || _a === void 0 ? void 0 : _a.optimizeNames(names, constants3);
        (_b = this.finally) === null || _b === void 0 ? void 0 : _b.optimizeNames(names, constants3);
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
    };
    var Catch = class extends BlockNode {
      constructor(error) {
        super();
        this.error = error;
      }
      render(opts) {
        return `catch(${this.error})` + super.render(opts);
      }
    };
    Catch.kind = "catch";
    var Finally = class extends BlockNode {
      render(opts) {
        return "finally" + super.render(opts);
      }
    };
    Finally.kind = "finally";
    var CodeGen = class {
      constructor(extScope, opts = {}) {
        this._values = {};
        this._blockStarts = [];
        this._constants = {};
        this.opts = { ...opts, _n: opts.lines ? "\n" : "" };
        this._extScope = extScope;
        this._scope = new scope_1.Scope({ parent: extScope });
        this._nodes = [new Root()];
      }
      toString() {
        return this._root.render(this.opts);
      }
      // returns unique name in the internal scope
      name(prefix) {
        return this._scope.name(prefix);
      }
      // reserves unique name in the external scope
      scopeName(prefix) {
        return this._extScope.name(prefix);
      }
      // reserves unique name in the external scope and assigns value to it
      scopeValue(prefixOrName, value) {
        const name = this._extScope.value(prefixOrName, value);
        const vs = this._values[name.prefix] || (this._values[name.prefix] = /* @__PURE__ */ new Set());
        vs.add(name);
        return name;
      }
      getScopeValue(prefix, keyOrRef) {
        return this._extScope.getValue(prefix, keyOrRef);
      }
      // return code that assigns values in the external scope to the names that are used internally
      // (same names that were returned by gen.scopeName or gen.scopeValue)
      scopeRefs(scopeName) {
        return this._extScope.scopeRefs(scopeName, this._values);
      }
      scopeCode() {
        return this._extScope.scopeCode(this._values);
      }
      _def(varKind, nameOrPrefix, rhs, constant) {
        const name = this._scope.toName(nameOrPrefix);
        if (rhs !== void 0 && constant)
          this._constants[name.str] = rhs;
        this._leafNode(new Def(varKind, name, rhs));
        return name;
      }
      // `const` declaration (`var` in es5 mode)
      const(nameOrPrefix, rhs, _constant) {
        return this._def(scope_1.varKinds.const, nameOrPrefix, rhs, _constant);
      }
      // `let` declaration with optional assignment (`var` in es5 mode)
      let(nameOrPrefix, rhs, _constant) {
        return this._def(scope_1.varKinds.let, nameOrPrefix, rhs, _constant);
      }
      // `var` declaration with optional assignment
      var(nameOrPrefix, rhs, _constant) {
        return this._def(scope_1.varKinds.var, nameOrPrefix, rhs, _constant);
      }
      // assignment code
      assign(lhs, rhs, sideEffects) {
        return this._leafNode(new Assign(lhs, rhs, sideEffects));
      }
      // `+=` code
      add(lhs, rhs) {
        return this._leafNode(new AssignOp(lhs, exports2.operators.ADD, rhs));
      }
      // appends passed SafeExpr to code or executes Block
      code(c) {
        if (typeof c == "function")
          c();
        else if (c !== code_1.nil)
          this._leafNode(new AnyCode(c));
        return this;
      }
      // returns code for object literal for the passed argument list of key-value pairs
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
      // `if` clause (or statement if `thenBody` and, optionally, `elseBody` are passed)
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
      // `else if` clause - invalid without `if` or after `else` clauses
      elseIf(condition) {
        return this._elseNode(new If(condition));
      }
      // `else` clause - only valid after `if` or `else if` clauses
      else() {
        return this._elseNode(new Else());
      }
      // end `if` statement (needed if gen.if was used only with condition)
      endIf() {
        return this._endBlockNode(If, Else);
      }
      _for(node, forBody) {
        this._blockNode(node);
        if (forBody)
          this.code(forBody).endFor();
        return this;
      }
      // a generic `for` clause (or statement if `forBody` is passed)
      for(iteration, forBody) {
        return this._for(new ForLoop(iteration), forBody);
      }
      // `for` statement for a range of values
      forRange(nameOrPrefix, from, to, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.let) {
        const name = this._scope.toName(nameOrPrefix);
        return this._for(new ForRange(varKind, name, from, to), () => forBody(name));
      }
      // `for-of` statement (in es5 mode replace with a normal for loop)
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
      // `for-in` statement.
      // With option `ownProperties` replaced with a `for-of` loop for object keys
      forIn(nameOrPrefix, obj, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.const) {
        if (this.opts.ownProperties) {
          return this.forOf(nameOrPrefix, (0, code_1._)`Object.keys(${obj})`, forBody);
        }
        const name = this._scope.toName(nameOrPrefix);
        return this._for(new ForIter("in", varKind, name, obj), () => forBody(name));
      }
      // end `for` loop
      endFor() {
        return this._endBlockNode(For);
      }
      // `label` statement
      label(label) {
        return this._leafNode(new Label(label));
      }
      // `break` statement
      break(label) {
        return this._leafNode(new Break(label));
      }
      // `return` statement
      return(value) {
        const node = new Return();
        this._blockNode(node);
        this.code(value);
        if (node.nodes.length !== 1)
          throw new Error('CodeGen: "return" should have one node');
        return this._endBlockNode(Return);
      }
      // `try` statement
      try(tryBody, catchCode, finallyCode) {
        if (!catchCode && !finallyCode)
          throw new Error('CodeGen: "try" without "catch" and "finally"');
        const node = new Try();
        this._blockNode(node);
        this.code(tryBody);
        if (catchCode) {
          const error = this.name("e");
          this._currNode = node.catch = new Catch(error);
          catchCode(error);
        }
        if (finallyCode) {
          this._currNode = node.finally = new Finally();
          this.code(finallyCode);
        }
        return this._endBlockNode(Catch, Finally);
      }
      // `throw` statement
      throw(error) {
        return this._leafNode(new Throw(error));
      }
      // start self-balancing block
      block(body, nodeCount) {
        this._blockStarts.push(this._nodes.length);
        if (body)
          this.code(body).endBlock(nodeCount);
        return this;
      }
      // end the current self-balancing block
      endBlock(nodeCount) {
        const len = this._blockStarts.pop();
        if (len === void 0)
          throw new Error("CodeGen: not in self-balancing block");
        const toClose = this._nodes.length - len;
        if (toClose < 0 || nodeCount !== void 0 && toClose !== nodeCount) {
          throw new Error(`CodeGen: wrong number of nodes: ${toClose} vs ${nodeCount} expected`);
        }
        this._nodes.length = len;
        return this;
      }
      // `function` heading (or definition if funcBody is passed)
      func(name, args = code_1.nil, async, funcBody) {
        this._blockNode(new Func(name, args, async));
        if (funcBody)
          this.code(funcBody).endFunc();
        return this;
      }
      // end function definition
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
    };
    exports2.CodeGen = CodeGen;
    function addNames(names, from) {
      for (const n in from)
        names[n] = (names[n] || 0) + (from[n] || 0);
      return names;
    }
    function addExprNames(names, from) {
      return from instanceof code_1._CodeOrName ? addNames(names, from.names) : names;
    }
    function optimizeExpr(expr, names, constants3) {
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
        const c = constants3[n.str];
        if (c === void 0 || names[n.str] !== 1)
          return n;
        delete names[n.str];
        return c;
      }
      function canOptimize(e) {
        return e instanceof code_1._Code && e._items.some((c) => c instanceof code_1.Name && names[c.str] === 1 && constants3[c.str] !== void 0);
      }
    }
    function subtractNames(names, from) {
      for (const n in from)
        names[n] = (names[n] || 0) - (from[n] || 0);
    }
    function not(x) {
      return typeof x == "boolean" || typeof x == "number" || x === null ? !x : (0, code_1._)`!${par(x)}`;
    }
    exports2.not = not;
    var andCode = mappend(exports2.operators.AND);
    function and(...args) {
      return args.reduce(andCode);
    }
    exports2.and = and;
    var orCode = mappend(exports2.operators.OR);
    function or(...args) {
      return args.reduce(orCode);
    }
    exports2.or = or;
    function mappend(op) {
      return (x, y) => x === code_1.nil ? y : y === code_1.nil ? x : (0, code_1._)`${par(x)} ${op} ${par(y)}`;
    }
    function par(x) {
      return x instanceof code_1.Name ? x : (0, code_1._)`(${x})`;
    }
  }
});

// node_modules/ajv/dist/compile/util.js
var require_util = __commonJS({
  "node_modules/ajv/dist/compile/util.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.checkStrictMode = exports2.getErrorPath = exports2.Type = exports2.useFunc = exports2.setEvaluated = exports2.evaluatedPropsToName = exports2.mergeEvaluated = exports2.eachItem = exports2.unescapeJsonPointer = exports2.escapeJsonPointer = exports2.escapeFragment = exports2.unescapeFragment = exports2.schemaRefOrVal = exports2.schemaHasRulesButRef = exports2.schemaHasRules = exports2.checkUnknownRules = exports2.alwaysValidSchema = exports2.toHash = void 0;
    var codegen_1 = require_codegen();
    var code_1 = require_code();
    function toHash(arr) {
      const hash = {};
      for (const item of arr)
        hash[item] = true;
      return hash;
    }
    exports2.toHash = toHash;
    function alwaysValidSchema(it, schema) {
      if (typeof schema == "boolean")
        return schema;
      if (Object.keys(schema).length === 0)
        return true;
      checkUnknownRules(it, schema);
      return !schemaHasRules(schema, it.self.RULES.all);
    }
    exports2.alwaysValidSchema = alwaysValidSchema;
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
    exports2.checkUnknownRules = checkUnknownRules;
    function schemaHasRules(schema, rules) {
      if (typeof schema == "boolean")
        return !schema;
      for (const key in schema)
        if (rules[key])
          return true;
      return false;
    }
    exports2.schemaHasRules = schemaHasRules;
    function schemaHasRulesButRef(schema, RULES) {
      if (typeof schema == "boolean")
        return !schema;
      for (const key in schema)
        if (key !== "$ref" && RULES.all[key])
          return true;
      return false;
    }
    exports2.schemaHasRulesButRef = schemaHasRulesButRef;
    function schemaRefOrVal({ topSchemaRef, schemaPath }, schema, keyword, $data) {
      if (!$data) {
        if (typeof schema == "number" || typeof schema == "boolean")
          return schema;
        if (typeof schema == "string")
          return (0, codegen_1._)`${schema}`;
      }
      return (0, codegen_1._)`${topSchemaRef}${schemaPath}${(0, codegen_1.getProperty)(keyword)}`;
    }
    exports2.schemaRefOrVal = schemaRefOrVal;
    function unescapeFragment(str) {
      return unescapeJsonPointer(decodeURIComponent(str));
    }
    exports2.unescapeFragment = unescapeFragment;
    function escapeFragment(str) {
      return encodeURIComponent(escapeJsonPointer(str));
    }
    exports2.escapeFragment = escapeFragment;
    function escapeJsonPointer(str) {
      if (typeof str == "number")
        return `${str}`;
      return str.replace(/~/g, "~0").replace(/\//g, "~1");
    }
    exports2.escapeJsonPointer = escapeJsonPointer;
    function unescapeJsonPointer(str) {
      return str.replace(/~1/g, "/").replace(/~0/g, "~");
    }
    exports2.unescapeJsonPointer = unescapeJsonPointer;
    function eachItem(xs, f) {
      if (Array.isArray(xs)) {
        for (const x of xs)
          f(x);
      } else {
        f(xs);
      }
    }
    exports2.eachItem = eachItem;
    function makeMergeEvaluated({ mergeNames, mergeToName, mergeValues, resultToName }) {
      return (gen, from, to, toName) => {
        const res = to === void 0 ? from : to instanceof codegen_1.Name ? (from instanceof codegen_1.Name ? mergeNames(gen, from, to) : mergeToName(gen, from, to), to) : from instanceof codegen_1.Name ? (mergeToName(gen, to, from), from) : mergeValues(from, to);
        return toName === codegen_1.Name && !(res instanceof codegen_1.Name) ? resultToName(gen, res) : res;
      };
    }
    exports2.mergeEvaluated = {
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
      if (ps !== void 0)
        setEvaluated(gen, props, ps);
      return props;
    }
    exports2.evaluatedPropsToName = evaluatedPropsToName;
    function setEvaluated(gen, props, ps) {
      Object.keys(ps).forEach((p) => gen.assign((0, codegen_1._)`${props}${(0, codegen_1.getProperty)(p)}`, true));
    }
    exports2.setEvaluated = setEvaluated;
    var snippets = {};
    function useFunc(gen, f) {
      return gen.scopeValue("func", {
        ref: f,
        code: snippets[f.code] || (snippets[f.code] = new code_1._Code(f.code))
      });
    }
    exports2.useFunc = useFunc;
    var Type;
    (function(Type2) {
      Type2[Type2["Num"] = 0] = "Num";
      Type2[Type2["Str"] = 1] = "Str";
    })(Type || (exports2.Type = Type = {}));
    function getErrorPath(dataProp, dataPropType, jsPropertySyntax) {
      if (dataProp instanceof codegen_1.Name) {
        const isNumber = dataPropType === Type.Num;
        return jsPropertySyntax ? isNumber ? (0, codegen_1._)`"[" + ${dataProp} + "]"` : (0, codegen_1._)`"['" + ${dataProp} + "']"` : isNumber ? (0, codegen_1._)`"/" + ${dataProp}` : (0, codegen_1._)`"/" + ${dataProp}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
      }
      return jsPropertySyntax ? (0, codegen_1.getProperty)(dataProp).toString() : "/" + escapeJsonPointer(dataProp);
    }
    exports2.getErrorPath = getErrorPath;
    function checkStrictMode(it, msg, mode = it.opts.strictSchema) {
      if (!mode)
        return;
      msg = `strict mode: ${msg}`;
      if (mode === true)
        throw new Error(msg);
      it.self.logger.warn(msg);
    }
    exports2.checkStrictMode = checkStrictMode;
  }
});

// node_modules/ajv/dist/compile/names.js
var require_names = __commonJS({
  "node_modules/ajv/dist/compile/names.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var names = {
      // validation function arguments
      data: new codegen_1.Name("data"),
      // data passed to validation function
      // args passed from referencing schema
      valCxt: new codegen_1.Name("valCxt"),
      // validation/data context - should not be used directly, it is destructured to the names below
      instancePath: new codegen_1.Name("instancePath"),
      parentData: new codegen_1.Name("parentData"),
      parentDataProperty: new codegen_1.Name("parentDataProperty"),
      rootData: new codegen_1.Name("rootData"),
      // root data - same as the data passed to the first/top validation function
      dynamicAnchors: new codegen_1.Name("dynamicAnchors"),
      // used to support recursiveRef and dynamicRef
      // function scoped variables
      vErrors: new codegen_1.Name("vErrors"),
      // null or array of validation errors
      errors: new codegen_1.Name("errors"),
      // counter of validation errors
      this: new codegen_1.Name("this"),
      // "globals"
      self: new codegen_1.Name("self"),
      scope: new codegen_1.Name("scope"),
      // JTD serialize/parse name for JSON string and position
      json: new codegen_1.Name("json"),
      jsonPos: new codegen_1.Name("jsonPos"),
      jsonLen: new codegen_1.Name("jsonLen"),
      jsonPart: new codegen_1.Name("jsonPart")
    };
    exports2.default = names;
  }
});

// node_modules/ajv/dist/compile/errors.js
var require_errors = __commonJS({
  "node_modules/ajv/dist/compile/errors.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.extendErrors = exports2.resetErrorsCount = exports2.reportExtraError = exports2.reportError = exports2.keyword$DataError = exports2.keywordError = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var names_1 = require_names();
    exports2.keywordError = {
      message: ({ keyword }) => (0, codegen_1.str)`must pass "${keyword}" keyword validation`
    };
    exports2.keyword$DataError = {
      message: ({ keyword, schemaType }) => schemaType ? (0, codegen_1.str)`"${keyword}" keyword must be ${schemaType} ($data)` : (0, codegen_1.str)`"${keyword}" keyword is invalid ($data)`
    };
    function reportError(cxt, error = exports2.keywordError, errorPaths, overrideAllErrors) {
      const { it } = cxt;
      const { gen, compositeRule, allErrors } = it;
      const errObj = errorObjectCode(cxt, error, errorPaths);
      if (overrideAllErrors !== null && overrideAllErrors !== void 0 ? overrideAllErrors : compositeRule || allErrors) {
        addError(gen, errObj);
      } else {
        returnErrors(it, (0, codegen_1._)`[${errObj}]`);
      }
    }
    exports2.reportError = reportError;
    function reportExtraError(cxt, error = exports2.keywordError, errorPaths) {
      const { it } = cxt;
      const { gen, compositeRule, allErrors } = it;
      const errObj = errorObjectCode(cxt, error, errorPaths);
      addError(gen, errObj);
      if (!(compositeRule || allErrors)) {
        returnErrors(it, names_1.default.vErrors);
      }
    }
    exports2.reportExtraError = reportExtraError;
    function resetErrorsCount(gen, errsCount) {
      gen.assign(names_1.default.errors, errsCount);
      gen.if((0, codegen_1._)`${names_1.default.vErrors} !== null`, () => gen.if(errsCount, () => gen.assign((0, codegen_1._)`${names_1.default.vErrors}.length`, errsCount), () => gen.assign(names_1.default.vErrors, null)));
    }
    exports2.resetErrorsCount = resetErrorsCount;
    function extendErrors({ gen, keyword, schemaValue, data, errsCount, it }) {
      if (errsCount === void 0)
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
    exports2.extendErrors = extendErrors;
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
      // also used in JTD errors
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
  }
});

// node_modules/ajv/dist/compile/validate/boolSchema.js
var require_boolSchema = __commonJS({
  "node_modules/ajv/dist/compile/validate/boolSchema.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.boolOrEmptySchema = exports2.topBoolOrEmptySchema = void 0;
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
    exports2.topBoolOrEmptySchema = topBoolOrEmptySchema;
    function boolOrEmptySchema(it, valid) {
      const { gen, schema } = it;
      if (schema === false) {
        gen.var(valid, false);
        falseSchemaError(it);
      } else {
        gen.var(valid, true);
      }
    }
    exports2.boolOrEmptySchema = boolOrEmptySchema;
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
      (0, errors_1.reportError)(cxt, boolError, void 0, overrideAllErrors);
    }
  }
});

// node_modules/ajv/dist/compile/rules.js
var require_rules = __commonJS({
  "node_modules/ajv/dist/compile/rules.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.getRules = exports2.isJSONType = void 0;
    var _jsonTypes = ["string", "number", "integer", "boolean", "null", "object", "array"];
    var jsonTypes = new Set(_jsonTypes);
    function isJSONType(x) {
      return typeof x == "string" && jsonTypes.has(x);
    }
    exports2.isJSONType = isJSONType;
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
    exports2.getRules = getRules;
  }
});

// node_modules/ajv/dist/compile/validate/applicability.js
var require_applicability = __commonJS({
  "node_modules/ajv/dist/compile/validate/applicability.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.shouldUseRule = exports2.shouldUseGroup = exports2.schemaHasRulesForType = void 0;
    function schemaHasRulesForType({ schema, self }, type) {
      const group = self.RULES.types[type];
      return group && group !== true && shouldUseGroup(schema, group);
    }
    exports2.schemaHasRulesForType = schemaHasRulesForType;
    function shouldUseGroup(schema, group) {
      return group.rules.some((rule) => shouldUseRule(schema, rule));
    }
    exports2.shouldUseGroup = shouldUseGroup;
    function shouldUseRule(schema, rule) {
      var _a;
      return schema[rule.keyword] !== void 0 || ((_a = rule.definition.implements) === null || _a === void 0 ? void 0 : _a.some((kwd) => schema[kwd] !== void 0));
    }
    exports2.shouldUseRule = shouldUseRule;
  }
});

// node_modules/ajv/dist/compile/validate/dataType.js
var require_dataType = __commonJS({
  "node_modules/ajv/dist/compile/validate/dataType.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.reportTypeError = exports2.checkDataTypes = exports2.checkDataType = exports2.coerceAndCheckDataType = exports2.getJSONTypes = exports2.getSchemaTypes = exports2.DataType = void 0;
    var rules_1 = require_rules();
    var applicability_1 = require_applicability();
    var errors_1 = require_errors();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var DataType;
    (function(DataType2) {
      DataType2[DataType2["Correct"] = 0] = "Correct";
      DataType2[DataType2["Wrong"] = 1] = "Wrong";
    })(DataType || (exports2.DataType = DataType = {}));
    function getSchemaTypes(schema) {
      const types = getJSONTypes(schema.type);
      const hasNull = types.includes("null");
      if (hasNull) {
        if (schema.nullable === false)
          throw new Error("type: null contradicts nullable: false");
      } else {
        if (!types.length && schema.nullable !== void 0) {
          throw new Error('"nullable" cannot be used without "type"');
        }
        if (schema.nullable === true)
          types.push("null");
      }
      return types;
    }
    exports2.getSchemaTypes = getSchemaTypes;
    function getJSONTypes(ts) {
      const types = Array.isArray(ts) ? ts : ts ? [ts] : [];
      if (types.every(rules_1.isJSONType))
        return types;
      throw new Error("type must be JSONType or JSONType[]: " + types.join(","));
    }
    exports2.getJSONTypes = getJSONTypes;
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
    exports2.coerceAndCheckDataType = coerceAndCheckDataType;
    var COERCIBLE = /* @__PURE__ */ new Set(["string", "number", "integer", "boolean", "null"]);
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
    exports2.checkDataType = checkDataType;
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
    exports2.checkDataTypes = checkDataTypes;
    var typeError = {
      message: ({ schema }) => `must be ${schema}`,
      params: ({ schema, schemaValue }) => typeof schema == "string" ? (0, codegen_1._)`{type: ${schema}}` : (0, codegen_1._)`{type: ${schemaValue}}`
    };
    function reportTypeError(it) {
      const cxt = getTypeErrorContext(it);
      (0, errors_1.reportError)(cxt, typeError);
    }
    exports2.reportTypeError = reportTypeError;
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
  }
});

// node_modules/ajv/dist/compile/validate/defaults.js
var require_defaults = __commonJS({
  "node_modules/ajv/dist/compile/validate/defaults.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.assignDefaults = void 0;
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
    exports2.assignDefaults = assignDefaults;
    function assignDefault(it, prop, defaultValue) {
      const { gen, compositeRule, data, opts } = it;
      if (defaultValue === void 0)
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
  }
});

// node_modules/ajv/dist/vocabularies/code.js
var require_code2 = __commonJS({
  "node_modules/ajv/dist/vocabularies/code.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.validateUnion = exports2.validateArray = exports2.usePattern = exports2.callValidateCode = exports2.schemaProperties = exports2.allSchemaProperties = exports2.noPropertyInData = exports2.propertyInData = exports2.isOwnProperty = exports2.hasPropFunc = exports2.reportMissingProp = exports2.checkMissingProp = exports2.checkReportMissingProp = void 0;
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
    exports2.checkReportMissingProp = checkReportMissingProp;
    function checkMissingProp({ gen, data, it: { opts } }, properties, missing) {
      return (0, codegen_1.or)(...properties.map((prop) => (0, codegen_1.and)(noPropertyInData(gen, data, prop, opts.ownProperties), (0, codegen_1._)`${missing} = ${prop}`)));
    }
    exports2.checkMissingProp = checkMissingProp;
    function reportMissingProp(cxt, missing) {
      cxt.setParams({ missingProperty: missing }, true);
      cxt.error();
    }
    exports2.reportMissingProp = reportMissingProp;
    function hasPropFunc(gen) {
      return gen.scopeValue("func", {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        ref: Object.prototype.hasOwnProperty,
        code: (0, codegen_1._)`Object.prototype.hasOwnProperty`
      });
    }
    exports2.hasPropFunc = hasPropFunc;
    function isOwnProperty(gen, data, property) {
      return (0, codegen_1._)`${hasPropFunc(gen)}.call(${data}, ${property})`;
    }
    exports2.isOwnProperty = isOwnProperty;
    function propertyInData(gen, data, property, ownProperties) {
      const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} !== undefined`;
      return ownProperties ? (0, codegen_1._)`${cond} && ${isOwnProperty(gen, data, property)}` : cond;
    }
    exports2.propertyInData = propertyInData;
    function noPropertyInData(gen, data, property, ownProperties) {
      const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} === undefined`;
      return ownProperties ? (0, codegen_1.or)(cond, (0, codegen_1.not)(isOwnProperty(gen, data, property))) : cond;
    }
    exports2.noPropertyInData = noPropertyInData;
    function allSchemaProperties(schemaMap) {
      return schemaMap ? Object.keys(schemaMap).filter((p) => p !== "__proto__") : [];
    }
    exports2.allSchemaProperties = allSchemaProperties;
    function schemaProperties(it, schemaMap) {
      return allSchemaProperties(schemaMap).filter((p) => !(0, util_1.alwaysValidSchema)(it, schemaMap[p]));
    }
    exports2.schemaProperties = schemaProperties;
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
    exports2.callValidateCode = callValidateCode;
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
    exports2.usePattern = usePattern;
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
    exports2.validateArray = validateArray;
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
    exports2.validateUnion = validateUnion;
  }
});

// node_modules/ajv/dist/compile/validate/keyword.js
var require_keyword = __commonJS({
  "node_modules/ajv/dist/compile/validate/keyword.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.validateKeywordUsage = exports2.validSchemaType = exports2.funcKeywordCode = exports2.macroKeywordCode = void 0;
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
    exports2.macroKeywordCode = macroKeywordCode;
    function funcKeywordCode(cxt, def) {
      var _a;
      const { gen, keyword, schema, parentSchema, $data, it } = cxt;
      checkAsyncKeyword(it, def);
      const validate = !$data && def.compile ? def.compile.call(it.self, schema, parentSchema, it) : def.validate;
      const validateRef = useKeyword(gen, keyword, validate);
      const valid = gen.let("valid");
      cxt.block$data(valid, validateKeyword);
      cxt.ok((_a = def.valid) !== null && _a !== void 0 ? _a : valid);
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
        const passSchema = !("compile" in def && !$data || def.schema === false);
        gen.assign(valid, (0, codegen_1._)`${_await}${(0, code_1.callValidateCode)(cxt, validateRef, passCxt, passSchema)}`, def.modifying);
      }
      function reportErrs(errors) {
        var _a2;
        gen.if((0, codegen_1.not)((_a2 = def.valid) !== null && _a2 !== void 0 ? _a2 : valid), errors);
      }
    }
    exports2.funcKeywordCode = funcKeywordCode;
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
      if (result === void 0)
        throw new Error(`keyword "${keyword}" failed to compile`);
      return gen.scopeValue("keyword", typeof result == "function" ? { ref: result } : { ref: result, code: (0, codegen_1.stringify)(result) });
    }
    function validSchemaType(schema, schemaType, allowUndefined = false) {
      return !schemaType.length || schemaType.some((st) => st === "array" ? Array.isArray(schema) : st === "object" ? schema && typeof schema == "object" && !Array.isArray(schema) : typeof schema == st || allowUndefined && typeof schema == "undefined");
    }
    exports2.validSchemaType = validSchemaType;
    function validateKeywordUsage({ schema, opts, self, errSchemaPath }, def, keyword) {
      if (Array.isArray(def.keyword) ? !def.keyword.includes(keyword) : def.keyword !== keyword) {
        throw new Error("ajv implementation error");
      }
      const deps = def.dependencies;
      if (deps === null || deps === void 0 ? void 0 : deps.some((kwd) => !Object.prototype.hasOwnProperty.call(schema, kwd))) {
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
    exports2.validateKeywordUsage = validateKeywordUsage;
  }
});

// node_modules/ajv/dist/compile/validate/subschema.js
var require_subschema = __commonJS({
  "node_modules/ajv/dist/compile/validate/subschema.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.extendSubschemaMode = exports2.extendSubschemaData = exports2.getSubschema = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    function getSubschema(it, { keyword, schemaProp, schema, schemaPath, errSchemaPath, topSchemaRef }) {
      if (keyword !== void 0 && schema !== void 0) {
        throw new Error('both "keyword" and "schema" passed, only one allowed');
      }
      if (keyword !== void 0) {
        const sch = it.schema[keyword];
        return schemaProp === void 0 ? {
          schema: sch,
          schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}`,
          errSchemaPath: `${it.errSchemaPath}/${keyword}`
        } : {
          schema: sch[schemaProp],
          schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}${(0, codegen_1.getProperty)(schemaProp)}`,
          errSchemaPath: `${it.errSchemaPath}/${keyword}/${(0, util_1.escapeFragment)(schemaProp)}`
        };
      }
      if (schema !== void 0) {
        if (schemaPath === void 0 || errSchemaPath === void 0 || topSchemaRef === void 0) {
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
    exports2.getSubschema = getSubschema;
    function extendSubschemaData(subschema, it, { dataProp, dataPropType: dpType, data, dataTypes, propertyName }) {
      if (data !== void 0 && dataProp !== void 0) {
        throw new Error('both "data" and "dataProp" passed, only one allowed');
      }
      const { gen } = it;
      if (dataProp !== void 0) {
        const { errorPath, dataPathArr, opts } = it;
        const nextData = gen.let("data", (0, codegen_1._)`${it.data}${(0, codegen_1.getProperty)(dataProp)}`, true);
        dataContextProps(nextData);
        subschema.errorPath = (0, codegen_1.str)`${errorPath}${(0, util_1.getErrorPath)(dataProp, dpType, opts.jsPropertySyntax)}`;
        subschema.parentDataProperty = (0, codegen_1._)`${dataProp}`;
        subschema.dataPathArr = [...dataPathArr, subschema.parentDataProperty];
      }
      if (data !== void 0) {
        const nextData = data instanceof codegen_1.Name ? data : gen.let("data", data, true);
        dataContextProps(nextData);
        if (propertyName !== void 0)
          subschema.propertyName = propertyName;
      }
      if (dataTypes)
        subschema.dataTypes = dataTypes;
      function dataContextProps(_nextData) {
        subschema.data = _nextData;
        subschema.dataLevel = it.dataLevel + 1;
        subschema.dataTypes = [];
        it.definedProperties = /* @__PURE__ */ new Set();
        subschema.parentData = it.data;
        subschema.dataNames = [...it.dataNames, _nextData];
      }
    }
    exports2.extendSubschemaData = extendSubschemaData;
    function extendSubschemaMode(subschema, { jtdDiscriminator, jtdMetadata, compositeRule, createErrors, allErrors }) {
      if (compositeRule !== void 0)
        subschema.compositeRule = compositeRule;
      if (createErrors !== void 0)
        subschema.createErrors = createErrors;
      if (allErrors !== void 0)
        subschema.allErrors = allErrors;
      subschema.jtdDiscriminator = jtdDiscriminator;
      subschema.jtdMetadata = jtdMetadata;
    }
    exports2.extendSubschemaMode = extendSubschemaMode;
  }
});

// node_modules/fast-deep-equal/index.js
var require_fast_deep_equal = __commonJS({
  "node_modules/fast-deep-equal/index.js"(exports2, module2) {
    "use strict";
    module2.exports = function equal(a, b) {
      if (a === b) return true;
      if (a && b && typeof a == "object" && typeof b == "object") {
        if (a.constructor !== b.constructor) return false;
        var length, i, keys;
        if (Array.isArray(a)) {
          length = a.length;
          if (length != b.length) return false;
          for (i = length; i-- !== 0; )
            if (!equal(a[i], b[i])) return false;
          return true;
        }
        if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
        if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
        if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();
        keys = Object.keys(a);
        length = keys.length;
        if (length !== Object.keys(b).length) return false;
        for (i = length; i-- !== 0; )
          if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;
        for (i = length; i-- !== 0; ) {
          var key = keys[i];
          if (!equal(a[key], b[key])) return false;
        }
        return true;
      }
      return a !== a && b !== b;
    };
  }
});

// node_modules/json-schema-traverse/index.js
var require_json_schema_traverse = __commonJS({
  "node_modules/json-schema-traverse/index.js"(exports2, module2) {
    "use strict";
    var traverse = module2.exports = function(schema, opts, cb) {
      if (typeof opts == "function") {
        cb = opts;
        opts = {};
      }
      cb = opts.cb || cb;
      var pre = typeof cb == "function" ? cb : cb.pre || function() {
      };
      var post = cb.post || function() {
      };
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
              for (var i = 0; i < sch.length; i++)
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
  }
});

// node_modules/ajv/dist/compile/resolve.js
var require_resolve = __commonJS({
  "node_modules/ajv/dist/compile/resolve.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.getSchemaRefs = exports2.resolveUrl = exports2.normalizeId = exports2._getFullPath = exports2.getFullPath = exports2.inlineRef = void 0;
    var util_1 = require_util();
    var equal = require_fast_deep_equal();
    var traverse = require_json_schema_traverse();
    var SIMPLE_INLINED = /* @__PURE__ */ new Set([
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
    exports2.inlineRef = inlineRef;
    var REF_KEYWORDS = /* @__PURE__ */ new Set([
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
    exports2.getFullPath = getFullPath;
    function _getFullPath(resolver, p) {
      const serialized = resolver.serialize(p);
      return serialized.split("#")[0] + "#";
    }
    exports2._getFullPath = _getFullPath;
    var TRAILING_SLASH_HASH = /#\/?$/;
    function normalizeId(id) {
      return id ? id.replace(TRAILING_SLASH_HASH, "") : "";
    }
    exports2.normalizeId = normalizeId;
    function resolveUrl(resolver, baseId, id) {
      id = normalizeId(id);
      return resolver.resolve(baseId, id);
    }
    exports2.resolveUrl = resolveUrl;
    var ANCHOR = /^[a-z_][-a-z0-9._]*$/i;
    function getSchemaRefs(schema, baseId) {
      if (typeof schema == "boolean")
        return {};
      const { schemaId, uriResolver } = this.opts;
      const schId = normalizeId(schema[schemaId] || baseId);
      const baseIds = { "": schId };
      const pathPrefix = getFullPath(uriResolver, schId, false);
      const localRefs = {};
      const schemaRefs = /* @__PURE__ */ new Set();
      traverse(schema, { allKeys: true }, (sch, jsonPtr, _, parentJsonPtr) => {
        if (parentJsonPtr === void 0)
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
        if (sch2 !== void 0 && !equal(sch1, sch2))
          throw ambiguos(ref);
      }
      function ambiguos(ref) {
        return new Error(`reference "${ref}" resolves to more than one schema`);
      }
    }
    exports2.getSchemaRefs = getSchemaRefs;
  }
});

// node_modules/ajv/dist/compile/validate/index.js
var require_validate = __commonJS({
  "node_modules/ajv/dist/compile/validate/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.getData = exports2.KeywordCxt = exports2.validateFunctionCode = void 0;
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
    exports2.validateFunctionCode = validateFunctionCode;
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
      if (schema.default !== void 0 && opts.useDefaults && opts.strictSchema) {
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
    var KeywordCxt = class {
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
        this.failResult((0, codegen_1.not)(condition), void 0, failAction);
      }
      fail(condition) {
        if (condition === void 0) {
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
        ;
        (append ? errors_1.reportExtraError : errors_1.reportError)(this, this.def.error, errorPaths);
      }
      $dataError() {
        (0, errors_1.reportError)(this, this.def.$dataError || errors_1.keyword$DataError);
      }
      reset() {
        if (this.errsCount === void 0)
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
        const nextContext = { ...this.it, ...subschema, items: void 0, props: void 0 };
        subschemaCode(nextContext, valid);
        return nextContext;
      }
      mergeEvaluated(schemaCxt, toName) {
        const { it, gen } = this;
        if (!it.opts.unevaluated)
          return;
        if (it.props !== true && schemaCxt.props !== void 0) {
          it.props = util_1.mergeEvaluated.props(gen, schemaCxt.props, it.props, toName);
        }
        if (it.items !== true && schemaCxt.items !== void 0) {
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
    };
    exports2.KeywordCxt = KeywordCxt;
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
    exports2.getData = getData;
  }
});

// node_modules/ajv/dist/runtime/validation_error.js
var require_validation_error = __commonJS({
  "node_modules/ajv/dist/runtime/validation_error.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var ValidationError = class extends Error {
      constructor(errors) {
        super("validation failed");
        this.errors = errors;
        this.ajv = this.validation = true;
      }
    };
    exports2.default = ValidationError;
  }
});

// node_modules/ajv/dist/compile/ref_error.js
var require_ref_error = __commonJS({
  "node_modules/ajv/dist/compile/ref_error.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var resolve_1 = require_resolve();
    var MissingRefError = class extends Error {
      constructor(resolver, baseId, ref, msg) {
        super(msg || `can't resolve reference ${ref} from id ${baseId}`);
        this.missingRef = (0, resolve_1.resolveUrl)(resolver, baseId, ref);
        this.missingSchema = (0, resolve_1.normalizeId)((0, resolve_1.getFullPath)(resolver, this.missingRef));
      }
    };
    exports2.default = MissingRefError;
  }
});

// node_modules/ajv/dist/compile/index.js
var require_compile = __commonJS({
  "node_modules/ajv/dist/compile/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.resolveSchema = exports2.getCompilingSchema = exports2.resolveRef = exports2.compileSchema = exports2.SchemaEnv = void 0;
    var codegen_1 = require_codegen();
    var validation_error_1 = require_validation_error();
    var names_1 = require_names();
    var resolve_1 = require_resolve();
    var util_1 = require_util();
    var validate_1 = require_validate();
    var SchemaEnv = class {
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
        this.baseId = (_a = env.baseId) !== null && _a !== void 0 ? _a : (0, resolve_1.normalizeId)(schema === null || schema === void 0 ? void 0 : schema[env.schemaId || "$id"]);
        this.schemaPath = env.schemaPath;
        this.localRefs = env.localRefs;
        this.meta = env.meta;
        this.$async = schema === null || schema === void 0 ? void 0 : schema.$async;
        this.refs = {};
      }
    };
    exports2.SchemaEnv = SchemaEnv;
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
        // TODO can its length be used as dataLevel if nil is removed?
        dataLevel: 0,
        dataTypes: [],
        definedProperties: /* @__PURE__ */ new Set(),
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
            props: props instanceof codegen_1.Name ? void 0 : props,
            items: items instanceof codegen_1.Name ? void 0 : items,
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
    exports2.compileSchema = compileSchema;
    function resolveRef(root, baseId, ref) {
      var _a;
      ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, ref);
      const schOrFunc = root.refs[ref];
      if (schOrFunc)
        return schOrFunc;
      let _sch = resolve3.call(this, root, ref);
      if (_sch === void 0) {
        const schema = (_a = root.localRefs) === null || _a === void 0 ? void 0 : _a[ref];
        const { schemaId } = this.opts;
        if (schema)
          _sch = new SchemaEnv({ schema, schemaId, root, baseId });
      }
      if (_sch === void 0)
        return;
      return root.refs[ref] = inlineOrCompile.call(this, _sch);
    }
    exports2.resolveRef = resolveRef;
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
    exports2.getCompilingSchema = getCompilingSchema;
    function sameSchemaEnv(s1, s2) {
      return s1.schema === s2.schema && s1.root === s2.root && s1.baseId === s2.baseId;
    }
    function resolve3(root, ref) {
      let sch;
      while (typeof (sch = this.refs[ref]) == "string")
        ref = sch;
      return sch || this.schemas[ref] || resolveSchema.call(this, root, ref);
    }
    function resolveSchema(root, ref) {
      const p = this.opts.uriResolver.parse(ref);
      const refPath = (0, resolve_1._getFullPath)(this.opts.uriResolver, p);
      let baseId = (0, resolve_1.getFullPath)(this.opts.uriResolver, root.baseId, void 0);
      if (Object.keys(root.schema).length > 0 && refPath === baseId) {
        return getJsonPointer.call(this, p, root);
      }
      const id = (0, resolve_1.normalizeId)(refPath);
      const schOrRef = this.refs[id] || this.schemas[id];
      if (typeof schOrRef == "string") {
        const sch = resolveSchema.call(this, root, schOrRef);
        if (typeof (sch === null || sch === void 0 ? void 0 : sch.schema) !== "object")
          return;
        return getJsonPointer.call(this, p, sch);
      }
      if (typeof (schOrRef === null || schOrRef === void 0 ? void 0 : schOrRef.schema) !== "object")
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
    exports2.resolveSchema = resolveSchema;
    var PREVENT_SCOPE_CHANGE = /* @__PURE__ */ new Set([
      "properties",
      "patternProperties",
      "enum",
      "dependencies",
      "definitions"
    ]);
    function getJsonPointer(parsedRef, { baseId, schema, root }) {
      var _a;
      if (((_a = parsedRef.fragment) === null || _a === void 0 ? void 0 : _a[0]) !== "/")
        return;
      for (const part of parsedRef.fragment.slice(1).split("/")) {
        if (typeof schema === "boolean")
          return;
        const partSchema = schema[(0, util_1.unescapeFragment)(part)];
        if (partSchema === void 0)
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
      return void 0;
    }
  }
});

// node_modules/ajv/dist/refs/data.json
var require_data = __commonJS({
  "node_modules/ajv/dist/refs/data.json"(exports2, module2) {
    module2.exports = {
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
  }
});

// node_modules/fast-uri/lib/utils.js
var require_utils = __commonJS({
  "node_modules/fast-uri/lib/utils.js"(exports2, module2) {
    "use strict";
    var isUUID = RegExp.prototype.test.bind(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu);
    var isIPv4 = RegExp.prototype.test.bind(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u);
    var isHexPair = RegExp.prototype.test.bind(/^[\da-f]{2}$/iu);
    var isUnreserved = RegExp.prototype.test.bind(/^[\da-z\-._~]$/iu);
    var isPathCharacter = RegExp.prototype.test.bind(/^[\da-z\-._~!$&'()*+,;=:@/]$/iu);
    function stringArrayToHexStripped(input2) {
      let acc = "";
      let code = 0;
      let i = 0;
      for (i = 0; i < input2.length; i++) {
        code = input2[i].charCodeAt(0);
        if (code === 48) {
          continue;
        }
        if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) {
          return "";
        }
        acc += input2[i];
        break;
      }
      for (i += 1; i < input2.length; i++) {
        code = input2[i].charCodeAt(0);
        if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) {
          return "";
        }
        acc += input2[i];
      }
      return acc;
    }
    var nonSimpleDomain = RegExp.prototype.test.bind(/[^!"$&'()*+,\-.;=_`a-z{}~]/u);
    function consumeIsZone(buffer) {
      buffer.length = 0;
      return true;
    }
    function consumeHextets(buffer, address, output2) {
      if (buffer.length) {
        const hex = stringArrayToHexStripped(buffer);
        if (hex !== "") {
          address.push(hex);
        } else {
          output2.error = true;
          return false;
        }
        buffer.length = 0;
      }
      return true;
    }
    function getIPV6(input2) {
      let tokenCount = 0;
      const output2 = { error: false, address: "", zone: "" };
      const address = [];
      const buffer = [];
      let endipv6Encountered = false;
      let endIpv6 = false;
      let consume = consumeHextets;
      for (let i = 0; i < input2.length; i++) {
        const cursor = input2[i];
        if (cursor === "[" || cursor === "]") {
          continue;
        }
        if (cursor === ":") {
          if (endipv6Encountered === true) {
            endIpv6 = true;
          }
          if (!consume(buffer, address, output2)) {
            break;
          }
          if (++tokenCount > 7) {
            output2.error = true;
            break;
          }
          if (i > 0 && input2[i - 1] === ":") {
            endipv6Encountered = true;
          }
          address.push(":");
          continue;
        } else if (cursor === "%") {
          if (!consume(buffer, address, output2)) {
            break;
          }
          consume = consumeIsZone;
        } else {
          buffer.push(cursor);
          continue;
        }
      }
      if (buffer.length) {
        if (consume === consumeIsZone) {
          output2.zone = buffer.join("");
        } else if (endIpv6) {
          address.push(buffer.join(""));
        } else {
          address.push(stringArrayToHexStripped(buffer));
        }
      }
      output2.address = address.join("");
      return output2;
    }
    function normalizeIPv6(host) {
      if (findToken(host, ":") < 2) {
        return { host, isIPV6: false };
      }
      const ipv6 = getIPV6(host);
      if (!ipv6.error) {
        let newHost = ipv6.address;
        let escapedHost = ipv6.address;
        if (ipv6.zone) {
          newHost += "%" + ipv6.zone;
          escapedHost += "%25" + ipv6.zone;
        }
        return { host: newHost, isIPV6: true, escapedHost };
      } else {
        return { host, isIPV6: false };
      }
    }
    function findToken(str, token) {
      let ind = 0;
      for (let i = 0; i < str.length; i++) {
        if (str[i] === token) ind++;
      }
      return ind;
    }
    function removeDotSegments(path) {
      let input2 = path;
      const output2 = [];
      let nextSlash = -1;
      let len = 0;
      while (len = input2.length) {
        if (len === 1) {
          if (input2 === ".") {
            break;
          } else if (input2 === "/") {
            output2.push("/");
            break;
          } else {
            output2.push(input2);
            break;
          }
        } else if (len === 2) {
          if (input2[0] === ".") {
            if (input2[1] === ".") {
              break;
            } else if (input2[1] === "/") {
              input2 = input2.slice(2);
              continue;
            }
          } else if (input2[0] === "/") {
            if (input2[1] === "." || input2[1] === "/") {
              output2.push("/");
              break;
            }
          }
        } else if (len === 3) {
          if (input2 === "/..") {
            if (output2.length !== 0) {
              output2.pop();
            }
            output2.push("/");
            break;
          }
        }
        if (input2[0] === ".") {
          if (input2[1] === ".") {
            if (input2[2] === "/") {
              input2 = input2.slice(3);
              continue;
            }
          } else if (input2[1] === "/") {
            input2 = input2.slice(2);
            continue;
          }
        } else if (input2[0] === "/") {
          if (input2[1] === ".") {
            if (input2[2] === "/") {
              input2 = input2.slice(2);
              continue;
            } else if (input2[2] === ".") {
              if (input2[3] === "/") {
                input2 = input2.slice(3);
                if (output2.length !== 0) {
                  output2.pop();
                }
                continue;
              }
            }
          }
        }
        if ((nextSlash = input2.indexOf("/", 1)) === -1) {
          output2.push(input2);
          break;
        } else {
          output2.push(input2.slice(0, nextSlash));
          input2 = input2.slice(nextSlash);
        }
      }
      return output2.join("");
    }
    var HOST_DELIMS = { "@": "%40", "/": "%2F", "?": "%3F", "#": "%23", ":": "%3A" };
    var HOST_DELIM_RE = /[@/?#:]/g;
    var HOST_DELIM_NO_COLON_RE = /[@/?#]/g;
    function reescapeHostDelimiters(host, isIP) {
      const re = isIP ? HOST_DELIM_NO_COLON_RE : HOST_DELIM_RE;
      re.lastIndex = 0;
      return host.replace(re, (ch) => HOST_DELIMS[ch]);
    }
    function normalizePercentEncoding(input2, decodeUnreserved = false) {
      if (input2.indexOf("%") === -1) {
        return input2;
      }
      let output2 = "";
      for (let i = 0; i < input2.length; i++) {
        if (input2[i] === "%" && i + 2 < input2.length) {
          const hex = input2.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            const normalizedHex = hex.toUpperCase();
            const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
            if (decodeUnreserved && isUnreserved(decoded)) {
              output2 += decoded;
            } else {
              output2 += "%" + normalizedHex;
            }
            i += 2;
            continue;
          }
        }
        output2 += input2[i];
      }
      return output2;
    }
    function normalizePathEncoding(input2) {
      let output2 = "";
      for (let i = 0; i < input2.length; i++) {
        if (input2[i] === "%" && i + 2 < input2.length) {
          const hex = input2.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            const normalizedHex = hex.toUpperCase();
            const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
            if (decoded !== "." && isUnreserved(decoded)) {
              output2 += decoded;
            } else {
              output2 += "%" + normalizedHex;
            }
            i += 2;
            continue;
          }
        }
        if (isPathCharacter(input2[i])) {
          output2 += input2[i];
        } else {
          output2 += escape(input2[i]);
        }
      }
      return output2;
    }
    function escapePreservingEscapes(input2) {
      let output2 = "";
      for (let i = 0; i < input2.length; i++) {
        if (input2[i] === "%" && i + 2 < input2.length) {
          const hex = input2.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            output2 += "%" + hex.toUpperCase();
            i += 2;
            continue;
          }
        }
        output2 += escape(input2[i]);
      }
      return output2;
    }
    function recomposeAuthority(component) {
      const uriTokens = [];
      if (component.userinfo !== void 0) {
        uriTokens.push(component.userinfo);
        uriTokens.push("@");
      }
      if (component.host !== void 0) {
        let host = unescape(component.host);
        if (!isIPv4(host)) {
          const ipV6res = normalizeIPv6(host);
          if (ipV6res.isIPV6 === true) {
            host = `[${ipV6res.escapedHost}]`;
          } else {
            host = reescapeHostDelimiters(host, false);
          }
        }
        uriTokens.push(host);
      }
      if (typeof component.port === "number" || typeof component.port === "string") {
        uriTokens.push(":");
        uriTokens.push(String(component.port));
      }
      return uriTokens.length ? uriTokens.join("") : void 0;
    }
    module2.exports = {
      nonSimpleDomain,
      recomposeAuthority,
      reescapeHostDelimiters,
      normalizePercentEncoding,
      normalizePathEncoding,
      escapePreservingEscapes,
      removeDotSegments,
      isIPv4,
      isUUID,
      normalizeIPv6,
      stringArrayToHexStripped
    };
  }
});

// node_modules/fast-uri/lib/schemes.js
var require_schemes = __commonJS({
  "node_modules/fast-uri/lib/schemes.js"(exports2, module2) {
    "use strict";
    var { isUUID } = require_utils();
    var URN_REG = /([\da-z][\d\-a-z]{0,31}):((?:[\w!$'()*+,\-.:;=@]|%[\da-f]{2})+)/iu;
    var supportedSchemeNames = (
      /** @type {const} */
      [
        "http",
        "https",
        "ws",
        "wss",
        "urn",
        "urn:uuid"
      ]
    );
    function isValidSchemeName(name) {
      return supportedSchemeNames.indexOf(
        /** @type {*} */
        name
      ) !== -1;
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
        component.port = void 0;
      }
      if (!component.path) {
        component.path = "/";
      }
      return component;
    }
    function wsParse(wsComponent) {
      wsComponent.secure = wsIsSecure(wsComponent);
      wsComponent.resourceName = (wsComponent.path || "/") + (wsComponent.query ? "?" + wsComponent.query : "");
      wsComponent.path = void 0;
      wsComponent.query = void 0;
      return wsComponent;
    }
    function wsSerialize(wsComponent) {
      if (wsComponent.port === (wsIsSecure(wsComponent) ? 443 : 80) || wsComponent.port === "") {
        wsComponent.port = void 0;
      }
      if (typeof wsComponent.secure === "boolean") {
        wsComponent.scheme = wsComponent.secure ? "wss" : "ws";
        wsComponent.secure = void 0;
      }
      if (wsComponent.resourceName) {
        const [path, query] = wsComponent.resourceName.split("?");
        wsComponent.path = path && path !== "/" ? path : void 0;
        wsComponent.query = query;
        wsComponent.resourceName = void 0;
      }
      wsComponent.fragment = void 0;
      return wsComponent;
    }
    function urnParse(urnComponent, options) {
      if (!urnComponent.path) {
        urnComponent.error = "URN can not be parsed";
        return urnComponent;
      }
      const matches = urnComponent.path.match(URN_REG);
      if (matches) {
        const scheme = options.scheme || urnComponent.scheme || "urn";
        urnComponent.nid = matches[1].toLowerCase();
        urnComponent.nss = matches[2];
        const urnScheme = `${scheme}:${options.nid || urnComponent.nid}`;
        const schemeHandler = getSchemeHandler(urnScheme);
        urnComponent.path = void 0;
        if (schemeHandler) {
          urnComponent = schemeHandler.parse(urnComponent, options);
        }
      } else {
        urnComponent.error = urnComponent.error || "URN can not be parsed.";
      }
      return urnComponent;
    }
    function urnSerialize(urnComponent, options) {
      if (urnComponent.nid === void 0) {
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
      uuidComponent.nss = void 0;
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
    var http = (
      /** @type {SchemeHandler} */
      {
        scheme: "http",
        domainHost: true,
        parse: httpParse,
        serialize: httpSerialize
      }
    );
    var https = (
      /** @type {SchemeHandler} */
      {
        scheme: "https",
        domainHost: http.domainHost,
        parse: httpParse,
        serialize: httpSerialize
      }
    );
    var ws = (
      /** @type {SchemeHandler} */
      {
        scheme: "ws",
        domainHost: true,
        parse: wsParse,
        serialize: wsSerialize
      }
    );
    var wss = (
      /** @type {SchemeHandler} */
      {
        scheme: "wss",
        domainHost: ws.domainHost,
        parse: ws.parse,
        serialize: ws.serialize
      }
    );
    var urn = (
      /** @type {SchemeHandler} */
      {
        scheme: "urn",
        parse: urnParse,
        serialize: urnSerialize,
        skipNormalize: true
      }
    );
    var urnuuid = (
      /** @type {SchemeHandler} */
      {
        scheme: "urn:uuid",
        parse: urnuuidParse,
        serialize: urnuuidSerialize,
        skipNormalize: true
      }
    );
    var SCHEMES = (
      /** @type {Record<SchemeName, SchemeHandler>} */
      {
        http,
        https,
        ws,
        wss,
        urn,
        "urn:uuid": urnuuid
      }
    );
    Object.setPrototypeOf(SCHEMES, null);
    function getSchemeHandler(scheme) {
      return scheme && (SCHEMES[
        /** @type {SchemeName} */
        scheme
      ] || SCHEMES[
        /** @type {SchemeName} */
        scheme.toLowerCase()
      ]) || void 0;
    }
    module2.exports = {
      wsIsSecure,
      SCHEMES,
      isValidSchemeName,
      getSchemeHandler
    };
  }
});

// node_modules/fast-uri/index.js
var require_fast_uri = __commonJS({
  "node_modules/fast-uri/index.js"(exports2, module2) {
    "use strict";
    var { normalizeIPv6, removeDotSegments, recomposeAuthority, normalizePercentEncoding, normalizePathEncoding, escapePreservingEscapes, reescapeHostDelimiters, isIPv4, nonSimpleDomain } = require_utils();
    var { SCHEMES, getSchemeHandler } = require_schemes();
    function normalize(uri, options) {
      if (typeof uri === "string") {
        uri = /** @type {T} */
        normalizeString(uri, options);
      } else if (typeof uri === "object") {
        uri = /** @type {T} */
        parse(serialize(uri, options), options);
      }
      return uri;
    }
    function resolve3(baseURI, relativeURI, options) {
      const schemelessOptions = options ? Object.assign({ scheme: "null" }, options) : { scheme: "null" };
      const resolved = resolveComponent(parse(baseURI, schemelessOptions), parse(relativeURI, schemelessOptions), schemelessOptions, true);
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
        if (relative.userinfo !== void 0 || relative.host !== void 0 || relative.port !== void 0) {
          target.userinfo = relative.userinfo;
          target.host = relative.host;
          target.port = relative.port;
          target.path = removeDotSegments(relative.path || "");
          target.query = relative.query;
        } else {
          if (!relative.path) {
            target.path = base.path;
            if (relative.query !== void 0) {
              target.query = relative.query;
            } else {
              target.query = base.query;
            }
          } else {
            if (relative.path[0] === "/") {
              target.path = removeDotSegments(relative.path);
            } else {
              if ((base.userinfo !== void 0 || base.host !== void 0 || base.port !== void 0) && !base.path) {
                target.path = "/" + relative.path;
              } else if (!base.path) {
                target.path = relative.path;
              } else {
                target.path = base.path.slice(0, base.path.lastIndexOf("/") + 1) + relative.path;
              }
              target.path = removeDotSegments(target.path);
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
      return normalizedA !== void 0 && normalizedB !== void 0 && normalizedA.toLowerCase() === normalizedB.toLowerCase();
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
      const schemeHandler = getSchemeHandler(options.scheme || component.scheme);
      if (schemeHandler && schemeHandler.serialize) schemeHandler.serialize(component, options);
      if (component.path !== void 0) {
        if (!options.skipEscape) {
          component.path = escapePreservingEscapes(component.path);
          if (component.scheme !== void 0) {
            component.path = component.path.split("%3A").join(":");
          }
        } else {
          component.path = normalizePercentEncoding(component.path);
        }
      }
      if (options.reference !== "suffix" && component.scheme) {
        uriTokens.push(component.scheme, ":");
      }
      const authority = recomposeAuthority(component);
      if (authority !== void 0) {
        if (options.reference !== "suffix") {
          uriTokens.push("//");
        }
        uriTokens.push(authority);
        if (component.path && component.path[0] !== "/") {
          uriTokens.push("/");
        }
      }
      if (component.path !== void 0) {
        let s = component.path;
        if (!options.absolutePath && (!schemeHandler || !schemeHandler.absolutePath)) {
          s = removeDotSegments(s);
        }
        if (authority === void 0 && s[0] === "/" && s[1] === "/") {
          s = "/%2F" + s.slice(2);
        }
        uriTokens.push(s);
      }
      if (component.query !== void 0) {
        uriTokens.push("?", component.query);
      }
      if (component.fragment !== void 0) {
        uriTokens.push("#", component.fragment);
      }
      return uriTokens.join("");
    }
    var URI_PARSE = /^(?:([^#/:?]+):)?(?:\/\/((?:([^#/?@]*)@)?(\[[^#/?\]]+\]|[^#/:?]*)(?::(\d*))?))?([^#?]*)(?:\?([^#]*))?(?:#((?:.|[\n\r])*))?/u;
    function getParseError(parsed, matches) {
      if (matches[2] !== void 0 && parsed.path && parsed.path[0] !== "/") {
        return 'URI path must start with "/" when authority is present.';
      }
      if (typeof parsed.port === "number" && (parsed.port < 0 || parsed.port > 65535)) {
        return "URI port is malformed.";
      }
      return void 0;
    }
    function parseWithStatus(uri, opts) {
      const options = Object.assign({}, opts);
      const parsed = {
        scheme: void 0,
        userinfo: void 0,
        host: "",
        port: void 0,
        path: "",
        query: void 0,
        fragment: void 0
      };
      let malformedAuthorityOrPort = false;
      let isIP = false;
      if (options.reference === "suffix") {
        if (options.scheme) {
          uri = options.scheme + ":" + uri;
        } else {
          uri = "//" + uri;
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
        if (isNaN(parsed.port)) {
          parsed.port = matches[5];
        }
        const parseError = getParseError(parsed, matches);
        if (parseError !== void 0) {
          parsed.error = parsed.error || parseError;
          malformedAuthorityOrPort = true;
        }
        if (parsed.host) {
          const ipv4result = isIPv4(parsed.host);
          if (ipv4result === false) {
            const ipv6result = normalizeIPv6(parsed.host);
            parsed.host = ipv6result.host.toLowerCase();
            isIP = ipv6result.isIPV6;
          } else {
            isIP = true;
          }
        }
        if (parsed.scheme === void 0 && parsed.userinfo === void 0 && parsed.host === void 0 && parsed.port === void 0 && parsed.query === void 0 && !parsed.path) {
          parsed.reference = "same-document";
        } else if (parsed.scheme === void 0) {
          parsed.reference = "relative";
        } else if (parsed.fragment === void 0) {
          parsed.reference = "absolute";
        } else {
          parsed.reference = "uri";
        }
        if (options.reference && options.reference !== "suffix" && options.reference !== parsed.reference) {
          parsed.error = parsed.error || "URI is not a " + options.reference + " reference.";
        }
        const schemeHandler = getSchemeHandler(options.scheme || parsed.scheme);
        if (!options.unicodeSupport && (!schemeHandler || !schemeHandler.unicodeSupport)) {
          if (parsed.host && (options.domainHost || schemeHandler && schemeHandler.domainHost) && isIP === false && nonSimpleDomain(parsed.host)) {
            try {
              parsed.host = URL.domainToASCII(parsed.host.toLowerCase());
            } catch (e) {
              parsed.error = parsed.error || "Host's domain name can not be converted to ASCII: " + e;
            }
          }
        }
        if (!schemeHandler || schemeHandler && !schemeHandler.skipNormalize) {
          if (uri.indexOf("%") !== -1) {
            if (parsed.scheme !== void 0) {
              parsed.scheme = unescape(parsed.scheme);
            }
            if (parsed.host !== void 0) {
              parsed.host = reescapeHostDelimiters(unescape(parsed.host), isIP);
            }
          }
          if (parsed.path) {
            parsed.path = normalizePathEncoding(parsed.path);
          }
          if (parsed.fragment) {
            try {
              parsed.fragment = encodeURI(decodeURIComponent(parsed.fragment));
            } catch {
              parsed.error = parsed.error || "URI malformed";
            }
          }
        }
        if (schemeHandler && schemeHandler.parse) {
          schemeHandler.parse(parsed, options);
        }
      } else {
        parsed.error = parsed.error || "URI can not be parsed.";
      }
      return { parsed, malformedAuthorityOrPort };
    }
    function parse(uri, opts) {
      return parseWithStatus(uri, opts).parsed;
    }
    function normalizeString(uri, opts) {
      return normalizeStringWithStatus(uri, opts).normalized;
    }
    function normalizeStringWithStatus(uri, opts) {
      const { parsed, malformedAuthorityOrPort } = parseWithStatus(uri, opts);
      return {
        normalized: malformedAuthorityOrPort ? uri : serialize(parsed, opts),
        malformedAuthorityOrPort
      };
    }
    function normalizeComparableURI(uri, opts) {
      if (typeof uri === "string") {
        const { normalized, malformedAuthorityOrPort } = normalizeStringWithStatus(uri, opts);
        return malformedAuthorityOrPort ? void 0 : normalized;
      }
      if (typeof uri === "object") {
        return serialize(uri, opts);
      }
    }
    var fastUri = {
      SCHEMES,
      normalize,
      resolve: resolve3,
      resolveComponent,
      equal,
      serialize,
      parse
    };
    module2.exports = fastUri;
    module2.exports.default = fastUri;
    module2.exports.fastUri = fastUri;
  }
});

// node_modules/ajv/dist/runtime/uri.js
var require_uri = __commonJS({
  "node_modules/ajv/dist/runtime/uri.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var uri = require_fast_uri();
    uri.code = 'require("ajv/dist/runtime/uri").default';
    exports2.default = uri;
  }
});

// node_modules/ajv/dist/core.js
var require_core = __commonJS({
  "node_modules/ajv/dist/core.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.CodeGen = exports2.Name = exports2.nil = exports2.stringify = exports2.str = exports2._ = exports2.KeywordCxt = void 0;
    var validate_1 = require_validate();
    Object.defineProperty(exports2, "KeywordCxt", { enumerable: true, get: function() {
      return validate_1.KeywordCxt;
    } });
    var codegen_1 = require_codegen();
    Object.defineProperty(exports2, "_", { enumerable: true, get: function() {
      return codegen_1._;
    } });
    Object.defineProperty(exports2, "str", { enumerable: true, get: function() {
      return codegen_1.str;
    } });
    Object.defineProperty(exports2, "stringify", { enumerable: true, get: function() {
      return codegen_1.stringify;
    } });
    Object.defineProperty(exports2, "nil", { enumerable: true, get: function() {
      return codegen_1.nil;
    } });
    Object.defineProperty(exports2, "Name", { enumerable: true, get: function() {
      return codegen_1.Name;
    } });
    Object.defineProperty(exports2, "CodeGen", { enumerable: true, get: function() {
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
    var EXT_SCOPE_NAMES = /* @__PURE__ */ new Set([
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
      const _optz = (_a = o.code) === null || _a === void 0 ? void 0 : _a.optimize;
      const optimize = _optz === true || _optz === void 0 ? 1 : _optz || 0;
      const regExp = (_c = (_b = o.code) === null || _b === void 0 ? void 0 : _b.regExp) !== null && _c !== void 0 ? _c : defaultRegExp;
      const uriResolver = (_d = o.uriResolver) !== null && _d !== void 0 ? _d : uri_1.default;
      return {
        strictSchema: (_f = (_e = o.strictSchema) !== null && _e !== void 0 ? _e : s) !== null && _f !== void 0 ? _f : true,
        strictNumbers: (_h = (_g = o.strictNumbers) !== null && _g !== void 0 ? _g : s) !== null && _h !== void 0 ? _h : true,
        strictTypes: (_k = (_j = o.strictTypes) !== null && _j !== void 0 ? _j : s) !== null && _k !== void 0 ? _k : "log",
        strictTuples: (_m = (_l = o.strictTuples) !== null && _l !== void 0 ? _l : s) !== null && _m !== void 0 ? _m : "log",
        strictRequired: (_p = (_o = o.strictRequired) !== null && _o !== void 0 ? _o : s) !== null && _p !== void 0 ? _p : false,
        code: o.code ? { ...o.code, optimize, regExp } : { optimize, regExp },
        loopRequired: (_q = o.loopRequired) !== null && _q !== void 0 ? _q : MAX_EXPRESSION,
        loopEnum: (_r = o.loopEnum) !== null && _r !== void 0 ? _r : MAX_EXPRESSION,
        meta: (_s = o.meta) !== null && _s !== void 0 ? _s : true,
        messages: (_t = o.messages) !== null && _t !== void 0 ? _t : true,
        inlineRefs: (_u = o.inlineRefs) !== null && _u !== void 0 ? _u : true,
        schemaId: (_v = o.schemaId) !== null && _v !== void 0 ? _v : "$id",
        addUsedSchema: (_w = o.addUsedSchema) !== null && _w !== void 0 ? _w : true,
        validateSchema: (_x = o.validateSchema) !== null && _x !== void 0 ? _x : true,
        validateFormats: (_y = o.validateFormats) !== null && _y !== void 0 ? _y : true,
        unicodeRegExp: (_z = o.unicodeRegExp) !== null && _z !== void 0 ? _z : true,
        int32range: (_0 = o.int32range) !== null && _0 !== void 0 ? _0 : true,
        uriResolver
      };
    }
    var Ajv3 = class {
      constructor(opts = {}) {
        this.schemas = {};
        this.refs = {};
        this.formats = /* @__PURE__ */ Object.create(null);
        this._compilations = /* @__PURE__ */ new Set();
        this._loading = {};
        this._cache = /* @__PURE__ */ new Map();
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
        return this.opts.defaultMeta = typeof meta == "object" ? meta[schemaId] || meta : void 0;
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
      // Adds schema to the instance
      addSchema(schema, key, _meta, _validateSchema = this.opts.validateSchema) {
        if (Array.isArray(schema)) {
          for (const sch of schema)
            this.addSchema(sch, void 0, _meta, _validateSchema);
          return this;
        }
        let id;
        if (typeof schema === "object") {
          const { schemaId } = this.opts;
          id = schema[schemaId];
          if (id !== void 0 && typeof id != "string") {
            throw new Error(`schema ${schemaId} must be string`);
          }
        }
        key = (0, resolve_1.normalizeId)(key || id);
        this._checkUnique(key);
        this.schemas[key] = this._addSchema(schema, _meta, key, _validateSchema, true);
        return this;
      }
      // Add schema that will be used to validate other schemas
      // options in META_IGNORE_OPTIONS are alway set to false
      addMetaSchema(schema, key, _validateSchema = this.opts.validateSchema) {
        this.addSchema(schema, key, true, _validateSchema);
        return this;
      }
      //  Validate schema against its meta-schema
      validateSchema(schema, throwOrLogError) {
        if (typeof schema == "boolean")
          return true;
        let $schema;
        $schema = schema.$schema;
        if ($schema !== void 0 && typeof $schema != "string") {
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
      // Get compiled schema by `key` or `ref`.
      // (`key` that was passed to `addSchema` or full schema reference - `schema.$id` or resolved id)
      getSchema(keyRef) {
        let sch;
        while (typeof (sch = getSchEnv.call(this, keyRef)) == "string")
          keyRef = sch;
        if (sch === void 0) {
          const { schemaId } = this.opts;
          const root = new compile_1.SchemaEnv({ schema: {}, schemaId });
          sch = compile_1.resolveSchema.call(this, root, keyRef);
          if (!sch)
            return;
          this.refs[keyRef] = sch;
        }
        return sch.validate || this._compileSchemaEnv(sch);
      }
      // Remove cached schema(s).
      // If no parameter is passed all schemas but meta-schemas are removed.
      // If RegExp is passed all schemas with key/id matching pattern but meta-schemas are removed.
      // Even if schema is referenced by other schemas it still can be removed as other schemas have local references.
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
      // add "vocabulary" - a collection of keywords
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
        } else if (typeof kwdOrDef == "object" && def === void 0) {
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
      // Remove keyword
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
      // Add format
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
        if (sch !== void 0)
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
    };
    Ajv3.ValidationError = validation_error_1.default;
    Ajv3.MissingRefError = ref_error_1.default;
    exports2.default = Ajv3;
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
    var noLogs = { log() {
    }, warn() {
    }, error() {
    } };
    function getLogger(logger) {
      if (logger === false)
        return noLogs;
      if (logger === void 0)
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
      if (def.$data && !("code" in def || "validate" in def)) {
        throw new Error('$data keyword must have "code" or "validate" function');
      }
    }
    function addRule(keyword, definition, dataType) {
      var _a;
      const post = definition === null || definition === void 0 ? void 0 : definition.post;
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
      (_a = definition.implements) === null || _a === void 0 ? void 0 : _a.forEach((kwd) => this.addKeyword(kwd));
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
      if (metaSchema === void 0)
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
  }
});

// node_modules/ajv/dist/vocabularies/core/id.js
var require_id = __commonJS({
  "node_modules/ajv/dist/vocabularies/core/id.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var def = {
      keyword: "id",
      code() {
        throw new Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/core/ref.js
var require_ref = __commonJS({
  "node_modules/ajv/dist/vocabularies/core/ref.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.callRef = exports2.getValidate = void 0;
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
        if (schOrEnv === void 0)
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
    exports2.getValidate = getValidate;
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
        const schEvaluated = (_a = sch === null || sch === void 0 ? void 0 : sch.validate) === null || _a === void 0 ? void 0 : _a.evaluated;
        if (it.props !== true) {
          if (schEvaluated && !schEvaluated.dynamicProps) {
            if (schEvaluated.props !== void 0) {
              it.props = util_1.mergeEvaluated.props(gen, schEvaluated.props, it.props);
            }
          } else {
            const props = gen.var("props", (0, codegen_1._)`${source}.evaluated.props`);
            it.props = util_1.mergeEvaluated.props(gen, props, it.props, codegen_1.Name);
          }
        }
        if (it.items !== true) {
          if (schEvaluated && !schEvaluated.dynamicItems) {
            if (schEvaluated.items !== void 0) {
              it.items = util_1.mergeEvaluated.items(gen, schEvaluated.items, it.items);
            }
          } else {
            const items = gen.var("items", (0, codegen_1._)`${source}.evaluated.items`);
            it.items = util_1.mergeEvaluated.items(gen, items, it.items, codegen_1.Name);
          }
        }
      }
    }
    exports2.callRef = callRef;
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/core/index.js
var require_core2 = __commonJS({
  "node_modules/ajv/dist/vocabularies/core/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
    exports2.default = core;
  }
});

// node_modules/ajv/dist/vocabularies/validation/limitNumber.js
var require_limitNumber = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/limitNumber.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/multipleOf.js
var require_multipleOf = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/multipleOf.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS({
  "node_modules/ajv/dist/runtime/ucs2length.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
    exports2.default = ucs2length;
    ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
  }
});

// node_modules/ajv/dist/vocabularies/validation/limitLength.js
var require_limitLength = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/limitLength.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/pattern.js
var require_pattern = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/pattern.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/limitProperties.js
var require_limitProperties = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/limitProperties.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/required.js
var require_required = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/required.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
            if ((props === null || props === void 0 ? void 0 : props[requiredKey]) === void 0 && !definedProperties.has(requiredKey)) {
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/limitItems.js
var require_limitItems = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/limitItems.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/runtime/equal.js
var require_equal = __commonJS({
  "node_modules/ajv/dist/runtime/equal.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var equal = require_fast_deep_equal();
    equal.code = 'require("ajv/dist/runtime/equal").default';
    exports2.default = equal;
  }
});

// node_modules/ajv/dist/vocabularies/validation/uniqueItems.js
var require_uniqueItems = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/uniqueItems.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/const.js
var require_const = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/const.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/enum.js
var require_enum = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/enum.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
        const getEql = () => eql !== null && eql !== void 0 ? eql : eql = (0, util_1.useFunc)(gen, equal_1.default);
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/index.js
var require_validation = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
      // number
      limitNumber_1.default,
      multipleOf_1.default,
      // string
      limitLength_1.default,
      pattern_1.default,
      // object
      limitProperties_1.default,
      required_1.default,
      // array
      limitItems_1.default,
      uniqueItems_1.default,
      // any
      { keyword: "type", schemaType: ["string", "array"] },
      { keyword: "nullable", schemaType: "boolean" },
      const_1.default,
      enum_1.default
    ];
    exports2.default = validation;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/additionalItems.js
var require_additionalItems = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/additionalItems.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.validateAdditionalItems = void 0;
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
    exports2.validateAdditionalItems = validateAdditionalItems;
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/items.js
var require_items = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/items.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.validateTuple = void 0;
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
    exports2.validateTuple = validateTuple;
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/prefixItems.js
var require_prefixItems = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/prefixItems.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var items_1 = require_items();
    var def = {
      keyword: "prefixItems",
      type: "array",
      schemaType: ["array"],
      before: "uniqueItems",
      code: (cxt) => (0, items_1.validateTuple)(cxt, "items")
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/items2020.js
var require_items2020 = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/items2020.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/contains.js
var require_contains = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/contains.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error = {
      message: ({ params: { min, max } }) => max === void 0 ? (0, codegen_1.str)`must contain at least ${min} valid item(s)` : (0, codegen_1.str)`must contain at least ${min} and no more than ${max} valid item(s)`,
      params: ({ params: { min, max } }) => max === void 0 ? (0, codegen_1._)`{minContains: ${min}}` : (0, codegen_1._)`{minContains: ${min}, maxContains: ${max}}`
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
          min = minContains === void 0 ? 1 : minContains;
          max = maxContains;
        } else {
          min = 1;
        }
        const len = gen.const("len", (0, codegen_1._)`${data}.length`);
        cxt.setParams({ min, max });
        if (max === void 0 && min === 0) {
          (0, util_1.checkStrictMode)(it, `"minContains" == 0 without "maxContains": "contains" keyword ignored`);
          return;
        }
        if (max !== void 0 && min > max) {
          (0, util_1.checkStrictMode)(it, `"minContains" > "maxContains" is always invalid`);
          cxt.fail();
          return;
        }
        if ((0, util_1.alwaysValidSchema)(it, schema)) {
          let cond = (0, codegen_1._)`${len} >= ${min}`;
          if (max !== void 0)
            cond = (0, codegen_1._)`${cond} && ${len} <= ${max}`;
          cxt.pass(cond);
          return;
        }
        it.items = true;
        const valid = gen.name("valid");
        if (max === void 0 && min === 1) {
          validateItems(valid, () => gen.if(valid, () => gen.break()));
        } else if (min === 0) {
          gen.let(valid, true);
          if (max !== void 0)
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
          if (max === void 0) {
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/dependencies.js
var require_dependencies = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/dependencies.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.validateSchemaDeps = exports2.validatePropertyDeps = exports2.error = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var code_1 = require_code2();
    exports2.error = {
      message: ({ params: { property, depsCount, deps } }) => {
        const property_ies = depsCount === 1 ? "property" : "properties";
        return (0, codegen_1.str)`must have ${property_ies} ${deps} when property ${property} is present`;
      },
      params: ({ params: { property, depsCount, deps, missingProperty } }) => (0, codegen_1._)`{property: ${property},
    missingProperty: ${missingProperty},
    depsCount: ${depsCount},
    deps: ${deps}}`
      // TODO change to reference
    };
    var def = {
      keyword: "dependencies",
      type: "object",
      schemaType: "object",
      error: exports2.error,
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
    exports2.validatePropertyDeps = validatePropertyDeps;
    function validateSchemaDeps(cxt, schemaDeps = cxt.schema) {
      const { gen, data, keyword, it } = cxt;
      const valid = gen.name("valid");
      for (const prop in schemaDeps) {
        if ((0, util_1.alwaysValidSchema)(it, schemaDeps[prop]))
          continue;
        gen.if(
          (0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties),
          () => {
            const schCxt = cxt.subschema({ keyword, schemaProp: prop }, valid);
            cxt.mergeValidEvaluated(schCxt, valid);
          },
          () => gen.var(valid, true)
          // TODO var
        );
        cxt.ok(valid);
      }
    }
    exports2.validateSchemaDeps = validateSchemaDeps;
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/propertyNames.js
var require_propertyNames = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/propertyNames.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/additionalProperties.js
var require_additionalProperties = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/additionalProperties.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/properties.js
var require_properties = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/properties.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
        if (it.opts.removeAdditional === "all" && parentSchema.additionalProperties === void 0) {
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
          return it.opts.useDefaults && !it.compositeRule && schema[prop].default !== void 0;
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/patternProperties.js
var require_patternProperties = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/patternProperties.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/not.js
var require_not = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/not.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/anyOf.js
var require_anyOf = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/anyOf.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var code_1 = require_code2();
    var def = {
      keyword: "anyOf",
      schemaType: "array",
      trackErrors: true,
      code: code_1.validateUnion,
      error: { message: "must match a schema in anyOf" }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/oneOf.js
var require_oneOf = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/oneOf.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/allOf.js
var require_allOf = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/allOf.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/if.js
var require_if = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/if.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
        if (parentSchema.then === void 0 && parentSchema.else === void 0) {
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
      return schema !== void 0 && !(0, util_1.alwaysValidSchema)(it, schema);
    }
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/thenElse.js
var require_thenElse = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/thenElse.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var util_1 = require_util();
    var def = {
      keyword: ["then", "else"],
      schemaType: ["object", "boolean"],
      code({ keyword, parentSchema, it }) {
        if (parentSchema.if === void 0)
          (0, util_1.checkStrictMode)(it, `"${keyword}" without "if" is ignored`);
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/index.js
var require_applicator = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
        // any
        not_1.default,
        anyOf_1.default,
        oneOf_1.default,
        allOf_1.default,
        if_1.default,
        thenElse_1.default,
        // object
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
    exports2.default = getApplicator;
  }
});

// node_modules/ajv/dist/vocabularies/dynamic/dynamicAnchor.js
var require_dynamicAnchor = __commonJS({
  "node_modules/ajv/dist/vocabularies/dynamic/dynamicAnchor.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.dynamicAnchor = void 0;
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
    exports2.dynamicAnchor = dynamicAnchor;
    function _getValidate(cxt) {
      const { schemaEnv, schema, self } = cxt.it;
      const { root, baseId, localRefs, meta } = schemaEnv.root;
      const { schemaId } = self.opts;
      const sch = new compile_1.SchemaEnv({ schema, schemaId, root, baseId, localRefs, meta });
      compile_1.compileSchema.call(self, sch);
      return (0, ref_1.getValidate)(cxt, sch);
    }
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/dynamic/dynamicRef.js
var require_dynamicRef = __commonJS({
  "node_modules/ajv/dist/vocabularies/dynamic/dynamicRef.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.dynamicRef = void 0;
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
    exports2.dynamicRef = dynamicRef;
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/dynamic/recursiveAnchor.js
var require_recursiveAnchor = __commonJS({
  "node_modules/ajv/dist/vocabularies/dynamic/recursiveAnchor.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/dynamic/recursiveRef.js
var require_recursiveRef = __commonJS({
  "node_modules/ajv/dist/vocabularies/dynamic/recursiveRef.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var dynamicRef_1 = require_dynamicRef();
    var def = {
      keyword: "$recursiveRef",
      schemaType: "string",
      code: (cxt) => (0, dynamicRef_1.dynamicRef)(cxt, cxt.schema)
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/dynamic/index.js
var require_dynamic = __commonJS({
  "node_modules/ajv/dist/vocabularies/dynamic/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var dynamicAnchor_1 = require_dynamicAnchor();
    var dynamicRef_1 = require_dynamicRef();
    var recursiveAnchor_1 = require_recursiveAnchor();
    var recursiveRef_1 = require_recursiveRef();
    var dynamic = [dynamicAnchor_1.default, dynamicRef_1.default, recursiveAnchor_1.default, recursiveRef_1.default];
    exports2.default = dynamic;
  }
});

// node_modules/ajv/dist/vocabularies/validation/dependentRequired.js
var require_dependentRequired = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/dependentRequired.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var dependencies_1 = require_dependencies();
    var def = {
      keyword: "dependentRequired",
      type: "object",
      schemaType: "object",
      error: dependencies_1.error,
      code: (cxt) => (0, dependencies_1.validatePropertyDeps)(cxt)
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/dependentSchemas.js
var require_dependentSchemas = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/dependentSchemas.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var dependencies_1 = require_dependencies();
    var def = {
      keyword: "dependentSchemas",
      type: "object",
      schemaType: "object",
      code: (cxt) => (0, dependencies_1.validateSchemaDeps)(cxt)
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/limitContains.js
var require_limitContains = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/limitContains.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var util_1 = require_util();
    var def = {
      keyword: ["maxContains", "minContains"],
      type: "array",
      schemaType: "number",
      code({ keyword, parentSchema, it }) {
        if (parentSchema.contains === void 0) {
          (0, util_1.checkStrictMode)(it, `"${keyword}" without "contains" is ignored`);
        }
      }
    };
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/next.js
var require_next = __commonJS({
  "node_modules/ajv/dist/vocabularies/next.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var dependentRequired_1 = require_dependentRequired();
    var dependentSchemas_1 = require_dependentSchemas();
    var limitContains_1 = require_limitContains();
    var next = [dependentRequired_1.default, dependentSchemas_1.default, limitContains_1.default];
    exports2.default = next;
  }
});

// node_modules/ajv/dist/vocabularies/unevaluated/unevaluatedProperties.js
var require_unevaluatedProperties = __commonJS({
  "node_modules/ajv/dist/vocabularies/unevaluated/unevaluatedProperties.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
          gen.forIn("key", data, (key) => props === void 0 ? unevaluatedPropCode(key) : gen.if(unevaluatedStatic(props, key), () => unevaluatedPropCode(key)));
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/unevaluated/unevaluatedItems.js
var require_unevaluatedItems = __commonJS({
  "node_modules/ajv/dist/vocabularies/unevaluated/unevaluatedItems.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/unevaluated/index.js
var require_unevaluated = __commonJS({
  "node_modules/ajv/dist/vocabularies/unevaluated/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var unevaluatedProperties_1 = require_unevaluatedProperties();
    var unevaluatedItems_1 = require_unevaluatedItems();
    var unevaluated = [unevaluatedProperties_1.default, unevaluatedItems_1.default];
    exports2.default = unevaluated;
  }
});

// node_modules/ajv/dist/vocabularies/format/format.js
var require_format = __commonJS({
  "node_modules/ajv/dist/vocabularies/format/format.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
            const code = fmtDef instanceof RegExp ? (0, codegen_1.regexpCode)(fmtDef) : opts.code.formats ? (0, codegen_1._)`${opts.code.formats}${(0, codegen_1.getProperty)(schema)}` : void 0;
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/format/index.js
var require_format2 = __commonJS({
  "node_modules/ajv/dist/vocabularies/format/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var format_1 = require_format();
    var format = [format_1.default];
    exports2.default = format;
  }
});

// node_modules/ajv/dist/vocabularies/metadata.js
var require_metadata = __commonJS({
  "node_modules/ajv/dist/vocabularies/metadata.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.contentVocabulary = exports2.metadataVocabulary = void 0;
    exports2.metadataVocabulary = [
      "title",
      "description",
      "default",
      "deprecated",
      "readOnly",
      "writeOnly",
      "examples"
    ];
    exports2.contentVocabulary = [
      "contentMediaType",
      "contentEncoding",
      "contentSchema"
    ];
  }
});

// node_modules/ajv/dist/vocabularies/draft2020.js
var require_draft2020 = __commonJS({
  "node_modules/ajv/dist/vocabularies/draft2020.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
    exports2.default = draft2020Vocabularies;
  }
});

// node_modules/ajv/dist/vocabularies/discriminator/types.js
var require_types = __commonJS({
  "node_modules/ajv/dist/vocabularies/discriminator/types.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.DiscrError = void 0;
    var DiscrError;
    (function(DiscrError2) {
      DiscrError2["Tag"] = "tag";
      DiscrError2["Mapping"] = "mapping";
    })(DiscrError || (exports2.DiscrError = DiscrError = {}));
  }
});

// node_modules/ajv/dist/vocabularies/discriminator/index.js
var require_discriminator = __commonJS({
  "node_modules/ajv/dist/vocabularies/discriminator/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
          for (let i = 0; i < oneOf.length; i++) {
            let sch = oneOf[i];
            if ((sch === null || sch === void 0 ? void 0 : sch.$ref) && !(0, util_1.schemaHasRulesButRef)(sch, it.self.RULES)) {
              const ref = sch.$ref;
              sch = compile_1.resolveRef.call(it.self, it.schemaEnv.root, it.baseId, ref);
              if (sch instanceof compile_1.SchemaEnv)
                sch = sch.schema;
              if (sch === void 0)
                throw new ref_error_1.default(it.opts.uriResolver, it.baseId, ref);
            }
            const propSch = (_a = sch === null || sch === void 0 ? void 0 : sch.properties) === null || _a === void 0 ? void 0 : _a[tagName];
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
    exports2.default = def;
  }
});

// node_modules/ajv/dist/refs/json-schema-2020-12/schema.json
var require_schema = __commonJS({
  "node_modules/ajv/dist/refs/json-schema-2020-12/schema.json"(exports2, module2) {
    module2.exports = {
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
  }
});

// node_modules/ajv/dist/refs/json-schema-2020-12/meta/applicator.json
var require_applicator2 = __commonJS({
  "node_modules/ajv/dist/refs/json-schema-2020-12/meta/applicator.json"(exports2, module2) {
    module2.exports = {
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
  }
});

// node_modules/ajv/dist/refs/json-schema-2020-12/meta/unevaluated.json
var require_unevaluated2 = __commonJS({
  "node_modules/ajv/dist/refs/json-schema-2020-12/meta/unevaluated.json"(exports2, module2) {
    module2.exports = {
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
  }
});

// node_modules/ajv/dist/refs/json-schema-2020-12/meta/content.json
var require_content = __commonJS({
  "node_modules/ajv/dist/refs/json-schema-2020-12/meta/content.json"(exports2, module2) {
    module2.exports = {
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
  }
});

// node_modules/ajv/dist/refs/json-schema-2020-12/meta/core.json
var require_core3 = __commonJS({
  "node_modules/ajv/dist/refs/json-schema-2020-12/meta/core.json"(exports2, module2) {
    module2.exports = {
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
  }
});

// node_modules/ajv/dist/refs/json-schema-2020-12/meta/format-annotation.json
var require_format_annotation = __commonJS({
  "node_modules/ajv/dist/refs/json-schema-2020-12/meta/format-annotation.json"(exports2, module2) {
    module2.exports = {
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
  }
});

// node_modules/ajv/dist/refs/json-schema-2020-12/meta/meta-data.json
var require_meta_data = __commonJS({
  "node_modules/ajv/dist/refs/json-schema-2020-12/meta/meta-data.json"(exports2, module2) {
    module2.exports = {
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
  }
});

// node_modules/ajv/dist/refs/json-schema-2020-12/meta/validation.json
var require_validation2 = __commonJS({
  "node_modules/ajv/dist/refs/json-schema-2020-12/meta/validation.json"(exports2, module2) {
    module2.exports = {
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
  }
});

// node_modules/ajv/dist/refs/json-schema-2020-12/index.js
var require_json_schema_2020_12 = __commonJS({
  "node_modules/ajv/dist/refs/json-schema-2020-12/index.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
      ;
      [
        metaSchema,
        applicator,
        unevaluated,
        content,
        core,
        with$data(this, format),
        metadata,
        with$data(this, validation)
      ].forEach((sch) => this.addMetaSchema(sch, void 0, false));
      return this;
      function with$data(ajv, sch) {
        return $data ? ajv.$dataMetaSchema(sch, META_SUPPORT_DATA) : sch;
      }
    }
    exports2.default = addMetaSchema2020;
  }
});

// node_modules/ajv/dist/2020.js
var require__ = __commonJS({
  "node_modules/ajv/dist/2020.js"(exports2, module2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.MissingRefError = exports2.ValidationError = exports2.CodeGen = exports2.Name = exports2.nil = exports2.stringify = exports2.str = exports2._ = exports2.KeywordCxt = exports2.Ajv2020 = void 0;
    var core_1 = require_core();
    var draft2020_1 = require_draft2020();
    var discriminator_1 = require_discriminator();
    var json_schema_2020_12_1 = require_json_schema_2020_12();
    var META_SCHEMA_ID = "https://json-schema.org/draft/2020-12/schema";
    var Ajv20202 = class extends core_1.default {
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
        return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(META_SCHEMA_ID) ? META_SCHEMA_ID : void 0);
      }
    };
    exports2.Ajv2020 = Ajv20202;
    module2.exports = exports2 = Ajv20202;
    module2.exports.Ajv2020 = Ajv20202;
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = Ajv20202;
    var validate_1 = require_validate();
    Object.defineProperty(exports2, "KeywordCxt", { enumerable: true, get: function() {
      return validate_1.KeywordCxt;
    } });
    var codegen_1 = require_codegen();
    Object.defineProperty(exports2, "_", { enumerable: true, get: function() {
      return codegen_1._;
    } });
    Object.defineProperty(exports2, "str", { enumerable: true, get: function() {
      return codegen_1.str;
    } });
    Object.defineProperty(exports2, "stringify", { enumerable: true, get: function() {
      return codegen_1.stringify;
    } });
    Object.defineProperty(exports2, "nil", { enumerable: true, get: function() {
      return codegen_1.nil;
    } });
    Object.defineProperty(exports2, "Name", { enumerable: true, get: function() {
      return codegen_1.Name;
    } });
    Object.defineProperty(exports2, "CodeGen", { enumerable: true, get: function() {
      return codegen_1.CodeGen;
    } });
    var validation_error_1 = require_validation_error();
    Object.defineProperty(exports2, "ValidationError", { enumerable: true, get: function() {
      return validation_error_1.default;
    } });
    var ref_error_1 = require_ref_error();
    Object.defineProperty(exports2, "MissingRefError", { enumerable: true, get: function() {
      return ref_error_1.default;
    } });
  }
});

// node_modules/ajv-formats/dist/formats.js
var require_formats = __commonJS({
  "node_modules/ajv-formats/dist/formats.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.formatNames = exports2.fastFormats = exports2.fullFormats = void 0;
    function fmtDef(validate, compare) {
      return { validate, compare };
    }
    exports2.fullFormats = {
      // date: http://tools.ietf.org/html/rfc3339#section-5.6
      date: fmtDef(date, compareDate),
      // date-time: http://tools.ietf.org/html/rfc3339#section-5.6
      time: fmtDef(getTime(true), compareTime),
      "date-time": fmtDef(getDateTime(true), compareDateTime),
      "iso-time": fmtDef(getTime(), compareIsoTime),
      "iso-date-time": fmtDef(getDateTime(), compareIsoDateTime),
      // duration: https://tools.ietf.org/html/rfc3339#appendix-A
      duration: /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/,
      uri,
      "uri-reference": /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i,
      // uri-template: https://tools.ietf.org/html/rfc6570
      "uri-template": /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
      // For the source: https://gist.github.com/dperini/729294
      // For test cases: https://mathiasbynens.be/demo/url-regex
      url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu,
      email: /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i,
      hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i,
      // optimized https://www.safaribooksonline.com/library/view/regular-expressions-cookbook/9780596802837/ch07s16.html
      ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
      ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i,
      regex,
      // uuid: http://tools.ietf.org/html/rfc4122
      uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
      // JSON-pointer: https://tools.ietf.org/html/rfc6901
      // uri fragment: https://tools.ietf.org/html/rfc3986#appendix-A
      "json-pointer": /^(?:\/(?:[^~/]|~0|~1)*)*$/,
      "json-pointer-uri-fragment": /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
      // relative JSON-pointer: http://tools.ietf.org/html/draft-luff-relative-json-pointer-00
      "relative-json-pointer": /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
      // the following formats are used by the openapi specification: https://spec.openapis.org/oas/v3.0.0#data-types
      // byte: https://github.com/miguelmota/is-base64
      byte,
      // signed 32 bit integer
      int32: { type: "number", validate: validateInt32 },
      // signed 64 bit integer
      int64: { type: "number", validate: validateInt64 },
      // C-type float
      float: { type: "number", validate: validateNumber },
      // C-type double
      double: { type: "number", validate: validateNumber },
      // hint to the UI to hide input strings
      password: true,
      // unchecked string payload
      binary: true
    };
    exports2.fastFormats = {
      ...exports2.fullFormats,
      date: fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d$/, compareDate),
      time: fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareTime),
      "date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareDateTime),
      "iso-time": fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoTime),
      "iso-date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d[t\s](?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoDateTime),
      // uri: https://github.com/mafintosh/is-my-json-valid/blob/master/formats.js
      uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
      "uri-reference": /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
      // email (sources from jsen validator):
      // http://stackoverflow.com/questions/201323/using-a-regular-expression-to-validate-an-email-address#answer-8829363
      // http://www.w3.org/TR/html5/forms.html#valid-e-mail-address (search for 'wilful violation')
      email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
    };
    exports2.formatNames = Object.keys(exports2.fullFormats);
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
        return void 0;
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
        return void 0;
      const t1 = (/* @__PURE__ */ new Date("2020-01-01T" + s1)).valueOf();
      const t2 = (/* @__PURE__ */ new Date("2020-01-01T" + s2)).valueOf();
      if (!(t1 && t2))
        return void 0;
      return t1 - t2;
    }
    function compareIsoTime(t1, t2) {
      if (!(t1 && t2))
        return void 0;
      const a1 = TIME.exec(t1);
      const a2 = TIME.exec(t2);
      if (!(a1 && a2))
        return void 0;
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
        return void 0;
      const d1 = new Date(dt1).valueOf();
      const d2 = new Date(dt2).valueOf();
      if (!(d1 && d2))
        return void 0;
      return d1 - d2;
    }
    function compareIsoDateTime(dt1, dt2) {
      if (!(dt1 && dt2))
        return void 0;
      const [d1, t1] = dt1.split(DATE_TIME_SEPARATOR);
      const [d2, t2] = dt2.split(DATE_TIME_SEPARATOR);
      const res = compareDate(d1, d2);
      if (res === void 0)
        return void 0;
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
  }
});

// node_modules/ajv/dist/vocabularies/draft7.js
var require_draft7 = __commonJS({
  "node_modules/ajv/dist/vocabularies/draft7.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
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
    exports2.default = draft7Vocabularies;
  }
});

// node_modules/ajv/dist/refs/json-schema-draft-07.json
var require_json_schema_draft_07 = __commonJS({
  "node_modules/ajv/dist/refs/json-schema-draft-07.json"(exports2, module2) {
    module2.exports = {
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
  }
});

// node_modules/ajv/dist/ajv.js
var require_ajv = __commonJS({
  "node_modules/ajv/dist/ajv.js"(exports2, module2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.MissingRefError = exports2.ValidationError = exports2.CodeGen = exports2.Name = exports2.nil = exports2.stringify = exports2.str = exports2._ = exports2.KeywordCxt = exports2.Ajv = void 0;
    var core_1 = require_core();
    var draft7_1 = require_draft7();
    var discriminator_1 = require_discriminator();
    var draft7MetaSchema = require_json_schema_draft_07();
    var META_SUPPORT_DATA = ["/properties"];
    var META_SCHEMA_ID = "http://json-schema.org/draft-07/schema";
    var Ajv3 = class extends core_1.default {
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
        return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(META_SCHEMA_ID) ? META_SCHEMA_ID : void 0);
      }
    };
    exports2.Ajv = Ajv3;
    module2.exports = exports2 = Ajv3;
    module2.exports.Ajv = Ajv3;
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = Ajv3;
    var validate_1 = require_validate();
    Object.defineProperty(exports2, "KeywordCxt", { enumerable: true, get: function() {
      return validate_1.KeywordCxt;
    } });
    var codegen_1 = require_codegen();
    Object.defineProperty(exports2, "_", { enumerable: true, get: function() {
      return codegen_1._;
    } });
    Object.defineProperty(exports2, "str", { enumerable: true, get: function() {
      return codegen_1.str;
    } });
    Object.defineProperty(exports2, "stringify", { enumerable: true, get: function() {
      return codegen_1.stringify;
    } });
    Object.defineProperty(exports2, "nil", { enumerable: true, get: function() {
      return codegen_1.nil;
    } });
    Object.defineProperty(exports2, "Name", { enumerable: true, get: function() {
      return codegen_1.Name;
    } });
    Object.defineProperty(exports2, "CodeGen", { enumerable: true, get: function() {
      return codegen_1.CodeGen;
    } });
    var validation_error_1 = require_validation_error();
    Object.defineProperty(exports2, "ValidationError", { enumerable: true, get: function() {
      return validation_error_1.default;
    } });
    var ref_error_1 = require_ref_error();
    Object.defineProperty(exports2, "MissingRefError", { enumerable: true, get: function() {
      return ref_error_1.default;
    } });
  }
});

// node_modules/ajv-formats/dist/limit.js
var require_limit = __commonJS({
  "node_modules/ajv-formats/dist/limit.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.formatLimitDefinition = void 0;
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
    exports2.formatLimitDefinition = {
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
            code: opts.code.formats ? (0, codegen_1._)`${opts.code.formats}${(0, codegen_1.getProperty)(format)}` : void 0
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
      ajv.addKeyword(exports2.formatLimitDefinition);
      return ajv;
    };
    exports2.default = formatLimitPlugin;
  }
});

// node_modules/ajv-formats/dist/index.js
var require_dist = __commonJS({
  "node_modules/ajv-formats/dist/index.js"(exports2, module2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    var formats_1 = require_formats();
    var limit_1 = require_limit();
    var codegen_1 = require_codegen();
    var fullName = new codegen_1.Name("fullFormats");
    var fastName = new codegen_1.Name("fastFormats");
    var formatsPlugin = (ajv, opts = { keywords: true }) => {
      if (Array.isArray(opts)) {
        addFormats4(ajv, opts, formats_1.fullFormats, fullName);
        return ajv;
      }
      const [formats, exportName] = opts.mode === "fast" ? [formats_1.fastFormats, fastName] : [formats_1.fullFormats, fullName];
      const list = opts.formats || formats_1.formatNames;
      addFormats4(ajv, list, formats, exportName);
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
    function addFormats4(ajv, list, fs, exportName) {
      var _a;
      var _b;
      (_a = (_b = ajv.opts.code).formats) !== null && _a !== void 0 ? _a : _b.formats = (0, codegen_1._)`require("ajv-formats/dist/formats").${exportName}`;
      for (const f of list)
        ajv.addFormat(f, fs[f]);
    }
    module2.exports = exports2 = formatsPlugin;
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.default = formatsPlugin;
  }
});

// bin/init.js
var init_exports = {};
__export(init_exports, {
  runInit: () => runInit
});
module.exports = __toCommonJS(init_exports);
var import_node_fs15 = require("node:fs");
var import_node_path14 = require("node:path");
var import_node_url2 = require("node:url");
var import_promises4 = require("node:readline/promises");
var import_node_process = require("node:process");

// src/lifecycle.js
var import_node_fs5 = require("node:fs");

// src/pointer.js
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");

// src/atomic-write.js
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_crypto = require("node:crypto");
var RETRY_ATTEMPTS = 5;
var RETRY_BACKOFF_MS = 50;
async function atomicWriteFile(target, bytes) {
  const dir = (0, import_node_path.dirname)(target);
  const base = (0, import_node_path.basename)(target);
  const suffix = `${process.pid}-${(0, import_node_crypto.randomBytes)(6).toString("hex")}`;
  const tmp = (0, import_node_path.join)(dir, `${base}.tmp.${suffix}`);
  const payload = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
  const fd = (0, import_node_fs.openSync)(tmp, import_node_fs.constants.O_CREAT | import_node_fs.constants.O_EXCL | import_node_fs.constants.O_WRONLY, 384);
  try {
    let written = 0;
    while (written < payload.length) {
      written += (0, import_node_fs.writeSync)(fd, payload, written, payload.length - written);
    }
    (0, import_node_fs.fsyncSync)(fd);
  } finally {
    (0, import_node_fs.closeSync)(fd);
  }
  let lastErr;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      (0, import_node_fs.renameSync)(tmp, target);
      return { tmp, target };
    } catch (err) {
      lastErr = err;
      if (err && (err.code === "EBUSY" || err.code === "EPERM")) {
        if (attempt < RETRY_ATTEMPTS - 1) {
          await sleep(RETRY_BACKOFF_MS);
          continue;
        }
      }
      throw err;
    }
  }
  throw lastErr;
}
async function atomicWriteFiles(entries) {
  const prepared = [];
  for (const { target, bytes } of entries) {
    const dir = (0, import_node_path.dirname)(target);
    const base = (0, import_node_path.basename)(target);
    const suffix = `${process.pid}-${(0, import_node_crypto.randomBytes)(6).toString("hex")}`;
    const tmp = (0, import_node_path.join)(dir, `${base}.tmp.${suffix}`);
    const payload = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
    const fd = (0, import_node_fs.openSync)(tmp, import_node_fs.constants.O_CREAT | import_node_fs.constants.O_EXCL | import_node_fs.constants.O_WRONLY, 384);
    try {
      let written = 0;
      while (written < payload.length) {
        written += (0, import_node_fs.writeSync)(fd, payload, written, payload.length - written);
      }
      (0, import_node_fs.fsyncSync)(fd);
    } finally {
      (0, import_node_fs.closeSync)(fd);
    }
    prepared.push({ tmp, target });
  }
  const results = [];
  for (const { tmp, target } of prepared) {
    let lastErr;
    let committed = false;
    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
      try {
        (0, import_node_fs.renameSync)(tmp, target);
        committed = true;
        break;
      } catch (err) {
        lastErr = err;
        if (err && (err.code === "EBUSY" || err.code === "EPERM")) {
          if (attempt < RETRY_ATTEMPTS - 1) {
            await sleep(RETRY_BACKOFF_MS);
            continue;
          }
        }
        throw err;
      }
    }
    if (!committed) throw lastErr;
    results.push({ tmp, target });
  }
  return results;
}
function sleep(ms) {
  return new Promise((resolve3) => setTimeout(resolve3, ms));
}

// src/pointer.js
function pointerFilePath(repoRoot) {
  return (0, import_node_path2.join)(repoRoot, "state", "session.json");
}
function readPointer(repoRoot) {
  const p = pointerFilePath(repoRoot);
  if (!(0, import_node_fs2.existsSync)(p)) return null;
  return JSON.parse((0, import_node_fs2.readFileSync)(p, "utf8"));
}
async function writePointer(repoRoot, { activeSessionId, updatedAt }) {
  const payload = {
    schema_version: 2,
    active_session_id: activeSessionId,
    updated_at: updatedAt || (/* @__PURE__ */ new Date()).toISOString()
  };
  const target = pointerFilePath(repoRoot);
  if (!(0, import_node_fs2.existsSync)((0, import_node_path2.dirname)(target))) (0, import_node_fs2.mkdirSync)((0, import_node_path2.dirname)(target), { recursive: true });
  await atomicWriteFile(target, JSON.stringify(payload, null, 2) + "\n");
  return payload;
}

// src/bundle.js
var import_node_fs3 = require("node:fs");
var import_node_path3 = require("node:path");
var import_node_crypto3 = require("node:crypto");
var import__ = __toESM(require__(), 1);
var import_ajv_formats = __toESM(require_dist(), 1);

// src/host.js
var import_node_os = require("node:os");
var import_node_crypto2 = require("node:crypto");
function hostFingerprint() {
  return (0, import_node_crypto2.createHash)("sha256").update((0, import_node_os.hostname)()).digest("hex");
}

// src/schemas.js
var bundleStateSchema = {
  $id: "https://hivemind.local/state/sessions/bundle.schema.json",
  title: "BundleSession",
  description: "Per-session orchestrator state living inside a portable bundle at state/sessions/<id>/session.json. Per resolved Q #8 the version field is named schema_version (matching the pointer file). The length caps that lived on next_action and subagent_results[].summary in the v1 schema were removed: in practice the orchestrator writes multi-paragraph handoff text and 2-4 paragraph subagent summaries, and capping those at 300/1000 characters caused the live bundle to fail validation. Those free-text fields (next_action, handoff_summary, subagent_results[].summary) stay deliberately uncapped for that reason. TASK-103 (R11+R10): the ARRAYS grew unbounded instead (the live bundle reached 83 decisions / 63 subagent_results / 260KB) with no replacing sensor after the length caps were removed, so decisions and subagent_results now carry maxItems caps \u2014 the enforced size sensor. src/bundle-compaction.js rotates entries beyond the cap into an append-only archive.jsonl inside the bundle dir (no data loss) BEFORE writeBundleSession (src/bundle.js) is called again; writeBundleSession itself validates every payload against this schema before the atomic write and throws a typed E_BUNDLE_INVALID with the ajv error paths on any violation, including these maxItems caps. subagent_results items also declare two optional fields the orchestrator uses (`task`: free-text label for the run, `agentId`: SendMessage continuation handle) \u2014 they are typed explicitly rather than waved through with additionalProperties: true, so the schema still documents the full payload shape.",
  type: "object",
  required: [
    "schema_version",
    "session_id",
    "lifecycle_state",
    "updated_at",
    "active_task",
    "workflow_step",
    "next_action",
    "handoff_summary"
  ],
  additionalProperties: false,
  properties: {
    schema_version: { const: 2 },
    session_id: {
      type: "string",
      pattern: "^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$"
    },
    lifecycle_state: { type: "string", enum: ["active", "paused", "ended"] },
    updated_at: { type: "string", format: "date-time" },
    active_task: {
      type: ["string", "null"],
      pattern: "^TASK-[0-9]{3,}$"
    },
    workflow_step: {
      type: "string",
      enum: ["idle", "fetch", "research", "test", "impl", "review", "update"]
    },
    next_action: {
      type: ["string", "null"],
      description: "Multi-paragraph description of the next step on resume. Intentionally uncapped \u2014 see schema description."
    },
    handoff_summary: { type: "string" },
    open_questions: { type: "array", default: [], items: { type: "string" } },
    blockers: { type: "array", default: [], items: { type: "string" } },
    decisions: {
      type: "array",
      default: [],
      // TASK-103 (R11+R10) — enforced size sensor: keep in lock-step with
      // src/bundle-compaction.js#MAX_DECISIONS and state/bundle.schema.json.
      maxItems: 15,
      items: {
        type: "object",
        required: ["at", "decision", "rationale"],
        additionalProperties: false,
        properties: {
          at: { type: "string", format: "date-time" },
          decision: { type: "string" },
          rationale: { type: "string" }
        }
      }
    },
    subagent_results: {
      type: "array",
      default: [],
      // TASK-103 (R11+R10) — enforced size sensor: keep in lock-step with
      // src/bundle-compaction.js#MAX_SUBAGENT_RESULTS and state/bundle.schema.json.
      maxItems: 15,
      items: {
        type: "object",
        required: ["agent", "at", "summary"],
        additionalProperties: false,
        properties: {
          agent: { type: "string", enum: ["researcher", "developer", "reviewer"] },
          at: { type: "string", format: "date-time" },
          summary: {
            type: "string",
            description: "Multi-paragraph subagent return summary. Intentionally uncapped \u2014 see schema description."
          },
          artifacts: { type: "array", default: [], items: { type: "string" } },
          task: {
            type: "string",
            description: "Optional free-text label naming the run this subagent did (e.g. 'TASK-004 phase 3a implementation')."
          },
          agentId: {
            type: "string",
            description: "Optional SendMessage continuation handle for re-spawning the same subagent in a later turn."
          }
        }
      }
    },
    pending_human_confirmation: { type: ["string", "null"], default: null },
    mode: {
      type: "string",
      enum: ["harness", "loop"],
      default: "harness",
      description: "Operating mode of the active session. 'harness' = default, human-gated, one-step-at-a-time. 'loop' = autonomous drive loop is active. Absence is treated as 'harness' (backward-compatible). TASK-063."
    },
    loop_auth: {
      type: "object",
      description: "Standing-authorization switches for the autonomous drive loop. All default false (most conservative). See commands/loop.md.",
      additionalProperties: false,
      properties: {
        auto_close_on_green_review: { type: "boolean", default: false },
        auto_push_after_close: { type: "boolean", default: false },
        uat_delegated_to_orchestrator: { type: "boolean", default: false },
        auto_version_bump_on_milestone: { type: "boolean", default: false },
        auto_consolidate: {
          type: "boolean",
          default: false,
          description: "Standing authorization to run Gate 5 phase/milestone consolidation without a per-step human check-in. Part of the unattended preset. TASK-075."
        }
      }
    },
    loop_state: {
      type: "object",
      description: "Runtime state for the autonomous drive loop (TASK-062). Stored in the bundle so crash-recovery can resume. Free-form \u2014 contents evolve with the loop implementation. TASK-110 (R10 one level down): beta_findings/note grew unbounded the same way decisions/subagent_results did (TASK-103) \u2014 beta_findings now carries maxItems and note carries maxLength, the enforced size sensors. Keep in lock-step with src/bundle-compaction.js#MAX_BETA_FINDINGS/MAX_NOTE_LENGTH and state/bundle.schema.json. src/bundle-compaction.js#compactLoopState rotates overflow into the SAME archive.jsonl the decisions/subagent_results mechanism uses, tagged type: 'loop_state_beta_finding' | 'loop_state_note' \u2014 no second archive.",
      additionalProperties: true,
      properties: {
        beta_findings: {
          type: "array",
          // TASK-110 — enforced size sensor: keep in lock-step with
          // src/bundle-compaction.js#MAX_BETA_FINDINGS and state/bundle.schema.json.
          maxItems: 15,
          items: { type: "string" }
        },
        note: {
          type: "string",
          // TASK-110 — enforced size sensor: keep in lock-step with
          // src/bundle-compaction.js#MAX_NOTE_LENGTH and state/bundle.schema.json.
          maxLength: 4e3
        }
      }
    }
  }
};

// src/bundle.js
function newSessionId(now = /* @__PURE__ */ new Date()) {
  const y = now.getUTCFullYear().toString().padStart(4, "0");
  const mo = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = now.getUTCDate().toString().padStart(2, "0");
  const h = now.getUTCHours().toString().padStart(2, "0");
  const mi = now.getUTCMinutes().toString().padStart(2, "0");
  const s = now.getUTCSeconds().toString().padStart(2, "0");
  const ts = `${y}${mo}${d}T${h}${mi}${s}Z`;
  const hex = (0, import_node_crypto3.randomBytes)(4).toString("hex");
  return `${ts}-${hex}`;
}
function bundleDirFor(repoRoot, sessionId) {
  return (0, import_node_path3.join)(repoRoot, "state", "sessions", sessionId);
}
function bundleSessionPath(repoRoot, sessionId) {
  return (0, import_node_path3.join)(bundleDirFor(repoRoot, sessionId), "session.json");
}
function bundleManifestPath(repoRoot, sessionId) {
  return (0, import_node_path3.join)(bundleDirFor(repoRoot, sessionId), "manifest.json");
}
function bundleLifecycleLogPath(repoRoot, sessionId) {
  return (0, import_node_path3.join)(bundleDirFor(repoRoot, sessionId), "lifecycle.log");
}
function bundleTranscriptRefPath(repoRoot, sessionId) {
  return (0, import_node_path3.join)(bundleDirFor(repoRoot, sessionId), "transcript.ref.json");
}
function bundleTranscriptSnapshotDir(repoRoot, sessionId) {
  return (0, import_node_path3.join)(bundleDirFor(repoRoot, sessionId), "transcript.snapshot");
}
function makeErr(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}
var _validateBundleState = null;
function getBundleStateValidator() {
  if (_validateBundleState) return _validateBundleState;
  const ajv = new import__.default({ allErrors: true, strict: false });
  (0, import_ajv_formats.default)(ajv);
  _validateBundleState = ajv.compile(bundleStateSchema);
  return _validateBundleState;
}
function validateBundleStateOrThrow(payload) {
  const validate = getBundleStateValidator();
  const ok = validate(payload);
  if (ok) return;
  const errors = validate.errors || [];
  const msg = errors.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
  const err = makeErr("E_BUNDLE_INVALID", `bundle session payload failed schema validation: ${msg}`);
  err.errors = errors;
  throw err;
}
async function writeBundleSession(repoRoot, sessionId, payload) {
  validateBundleStateOrThrow(payload);
  const dir = bundleDirFor(repoRoot, sessionId);
  if (!(0, import_node_fs3.existsSync)(dir)) (0, import_node_fs3.mkdirSync)(dir, { recursive: true });
  const target = bundleSessionPath(repoRoot, sessionId);
  await atomicWriteFile(target, JSON.stringify(payload, null, 2) + "\n");
}
function appendLifecycleLog(repoRoot, sessionId, entry) {
  const p = bundleLifecycleLogPath(repoRoot, sessionId);
  if (!(0, import_node_fs3.existsSync)((0, import_node_path3.dirname)(p))) (0, import_node_fs3.mkdirSync)((0, import_node_path3.dirname)(p), { recursive: true });
  (0, import_node_fs3.appendFileSync)(p, JSON.stringify(entry) + "\n", "utf8");
}
function makeManifest({ sessionId, createdAt, snapshotTranscript, transcriptRefs = [] }) {
  return {
    session_id: sessionId,
    schema_version: 1,
    created_at: createdAt,
    host: hostFingerprint(),
    snapshot_transcript: !!snapshotTranscript,
    transcript_refs: transcriptRefs
  };
}
async function writeManifest(repoRoot, sessionId, manifest) {
  const dir = bundleDirFor(repoRoot, sessionId);
  if (!(0, import_node_fs3.existsSync)(dir)) (0, import_node_fs3.mkdirSync)(dir, { recursive: true });
  const target = bundleManifestPath(repoRoot, sessionId);
  await atomicWriteFile(target, JSON.stringify(manifest, null, 2) + "\n");
}

// src/transcript.js
var import_node_fs4 = require("node:fs");
var import_node_os2 = require("node:os");
var import_node_path4 = require("node:path");
var import_node_crypto4 = require("node:crypto");
function encodeProjectPath(repoRoot) {
  const abs = (0, import_node_path4.resolve)(repoRoot);
  return abs.replace(/[\\/:]+/g, "-");
}
function resolveTranscriptDir(opts = {}) {
  const env = process.env.CLAUDE_CODE_TRANSCRIPT_DIR;
  if (env && env.length > 0) return env;
  if (opts.repoRoot) {
    const candidate = (0, import_node_path4.join)((0, import_node_os2.homedir)(), ".claude", "projects", encodeProjectPath(opts.repoRoot));
    if ((0, import_node_fs4.existsSync)(candidate)) return candidate;
  }
  return null;
}
async function captureTranscriptRefs({ repoRoot, sessionId }) {
  const src = resolveTranscriptDir({ repoRoot });
  if (!src || !(0, import_node_fs4.existsSync)(src)) {
    return [];
  }
  const refs = [];
  for (const name of (0, import_node_fs4.readdirSync)(src)) {
    const full = (0, import_node_path4.join)(src, name);
    let exists = false;
    let sha = null;
    try {
      const stat = (0, import_node_fs4.statSync)(full);
      if (stat.isFile()) {
        exists = true;
        const content = (0, import_node_fs4.readFileSync)(full);
        sha = (0, import_node_crypto4.createHash)("sha256").update(content).digest("hex");
      }
    } catch {
      exists = false;
    }
    refs.push({ path: full, exists_at_capture: exists, sha256: sha });
  }
  const refDoc = { claude_code_transcripts: refs };
  await atomicWriteFile(
    bundleTranscriptRefPath(repoRoot, sessionId),
    JSON.stringify(refDoc, null, 2) + "\n"
  );
  return refs;
}
async function snapshotTranscripts({ repoRoot, sessionId }) {
  const src = resolveTranscriptDir({ repoRoot });
  if (!src || !(0, import_node_fs4.existsSync)(src)) {
    return { copied: 0, skipped: "no_transcript_dir" };
  }
  const dstDir = bundleTranscriptSnapshotDir(repoRoot, sessionId);
  if (!(0, import_node_fs4.existsSync)(dstDir)) (0, import_node_fs4.mkdirSync)(dstDir, { recursive: true });
  let copied = 0;
  for (const name of (0, import_node_fs4.readdirSync)(src)) {
    const full = (0, import_node_path4.join)(src, name);
    let isFile = false;
    try {
      isFile = (0, import_node_fs4.statSync)(full).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) continue;
    const dst = (0, import_node_path4.join)(dstDir, name);
    (0, import_node_fs4.copyFileSync)(full, dst);
    copied++;
  }
  return { copied };
}

// src/lifecycle.js
async function startSession(opts) {
  const {
    repoRoot,
    activeTask = null,
    workflowStep = "idle",
    handoffSummary = "session started",
    nextAction = null,
    snapshotTranscript = false
  } = opts;
  if (!repoRoot) throw makeErr2("E_LIFECYCLE_ARGS", "startSession: repoRoot is required");
  const now = /* @__PURE__ */ new Date();
  const nowIso = now.toISOString();
  const sessionId = newSessionId(now);
  const bundleDir = bundleDirFor(repoRoot, sessionId);
  (0, import_node_fs5.mkdirSync)(bundleDir, { recursive: true });
  await writeManifest(
    repoRoot,
    sessionId,
    makeManifest({ sessionId, createdAt: nowIso, snapshotTranscript })
  );
  await writeBundleSession(repoRoot, sessionId, {
    schema_version: 2,
    session_id: sessionId,
    lifecycle_state: "active",
    updated_at: nowIso,
    active_task: activeTask,
    workflow_step: workflowStep,
    next_action: nextAction,
    handoff_summary: handoffSummary,
    open_questions: [],
    blockers: [],
    decisions: [],
    subagent_results: [],
    pending_human_confirmation: null
  });
  appendLifecycleLog(repoRoot, sessionId, {
    at: nowIso,
    op: "start",
    from_step: null,
    to_step: workflowStep,
    idempotent_noop: false
  });
  if (snapshotTranscript) {
    await captureTranscriptRefs({ repoRoot, sessionId });
    await snapshotTranscripts({ repoRoot, sessionId });
  }
  await writePointer(repoRoot, { activeSessionId: sessionId, updatedAt: nowIso });
  return { sessionId };
}
function makeErr2(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// src/question-engine.js
var import_node_fs6 = require("node:fs");
var VALID_TYPES = /* @__PURE__ */ new Set(["string", "number", "enum", "multi"]);
async function runQuestionnaire({
  questions,
  prompter,
  persistTo,
  now = () => (/* @__PURE__ */ new Date()).toISOString()
}) {
  if (!Array.isArray(questions)) {
    throw new Error("runQuestionnaire: `questions` must be an array");
  }
  const seenIds = /* @__PURE__ */ new Set();
  for (const q of questions) {
    if (!q || typeof q.id !== "string") {
      throw new Error("runQuestionnaire: every question requires a string `id`");
    }
    if (!VALID_TYPES.has(q.type)) {
      throw new Error(
        `runQuestionnaire: question "${q.id}" has unknown type "${q.type}" (expected one of: ${[...VALID_TYPES].join(", ")})`
      );
    }
    if (seenIds.has(q.id)) {
      throw new Error(
        `runQuestionnaire: duplicate question id "${q.id}" \u2014 ids must be unique`
      );
    }
    seenIds.add(q.id);
  }
  let answers = {};
  if (persistTo && (0, import_node_fs6.existsSync)(persistTo)) {
    try {
      const raw = JSON.parse((0, import_node_fs6.readFileSync)(persistTo, "utf8"));
      if (raw && typeof raw === "object" && raw.answers && typeof raw.answers === "object") {
        answers = { ...raw.answers };
      }
    } catch {
      answers = {};
    }
  }
  for (const q of questions) {
    if (Object.prototype.hasOwnProperty.call(answers, q.id)) {
      continue;
    }
    if (typeof q.when === "function" && q.when(answers) === false) {
      continue;
    }
    const required = q.required !== false;
    let lastError;
    while (true) {
      const ctx = { prompt: q.prompt, type: q.type };
      if (q.enum !== void 0) ctx.enum = q.enum;
      if (lastError !== void 0) ctx.error = lastError;
      const raw = await prompter(ctx);
      const validated = validateAndCoerce(q, raw, required, answers);
      if (validated.error) {
        lastError = validated.error;
        continue;
      }
      answers[q.id] = validated.value;
      if (persistTo) {
        const payload = JSON.stringify(
          { answers, lastAnsweredId: q.id },
          null,
          2
        ) + "\n";
        await atomicWriteFile(persistTo, payload);
      }
      break;
    }
  }
  return { answers, completedAt: now() };
}
function validateAndCoerce(q, raw, required, answers) {
  const rawStr = typeof raw === "string" ? raw : String(raw ?? "");
  const trimmed = rawStr.trim();
  if (trimmed.length === 0) {
    if (!required) {
      return { value: null };
    }
    return { error: `field "${q.id}" is required` };
  }
  let value;
  switch (q.type) {
    case "string": {
      value = rawStr;
      break;
    }
    case "number": {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) {
        return { error: `field "${q.id}" must be a number (got "${rawStr}")` };
      }
      value = n;
      break;
    }
    case "enum": {
      const choices = Array.isArray(q.enum) ? q.enum : [];
      if (!choices.includes(trimmed)) {
        return {
          error: `field "${q.id}" must be one of enum [${choices.join(", ")}] (got "${trimmed}")`
        };
      }
      value = trimmed;
      break;
    }
    case "multi": {
      const choices = Array.isArray(q.enum) ? q.enum : [];
      const tokens = [...new Set(
        rawStr.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
      )];
      const unknown = tokens.filter((t) => !choices.includes(t));
      if (unknown.length > 0) {
        return {
          error: `field "${q.id}" has unknown value(s) [${unknown.join(", ")}]; valid values are [${choices.join(", ")}]`
        };
      }
      value = tokens;
      break;
    }
    default:
      return { error: `field "${q.id}" has unsupported type "${q.type}"` };
  }
  if (typeof q.validate === "function") {
    const verdict = q.validate(value, answers);
    if (verdict) {
      return { error: String(verdict) };
    }
  }
  return { value };
}

// src/question-library.js
var PROJECT_TYPES = Object.freeze([
  "web-saas",
  "cli-tool",
  "data-pipeline",
  "ml-model",
  "library",
  "other"
]);
var COMMON_QUESTIONS = Object.freeze([
  // TASK-046 — Discovery-first intake: the four definition questions lead the
  // wizard so the operator defines WHAT they are building before the project is
  // named and classified. All four are type:'string', no `when` predicate (asked
  // of every project type). Comma-separated answers for goals/scope_in/scope_out
  // are normalized into arrays by bin/init.js normalizeDefinitionAnswers() before
  // writeProjectMd is called. An empty answer is accepted here (the field is
  // optional prose); the normalizer converts '' → [] which writeProjectMd renders
  // as no heading (TASK-045 empty-omission guard).
  {
    id: "problem_statement",
    type: "string",
    prompt: "What problem are you solving? (one or two sentences)"
  },
  {
    id: "goals",
    type: "string",
    required: false,
    prompt: "Key goals (comma-separated, or press Enter to skip)"
  },
  {
    id: "scope_in",
    type: "string",
    required: false,
    prompt: "In scope (comma-separated, or press Enter to skip)"
  },
  {
    id: "scope_out",
    type: "string",
    required: false,
    prompt: "Out of scope / non-goals (comma-separated, or press Enter to skip)"
  },
  {
    id: "project_name",
    type: "string",
    prompt: "Project name (short, kebab-case preferred)"
  },
  {
    id: "project_description",
    type: "string",
    prompt: "One sentence describing what this project does"
  },
  {
    id: "project_type",
    type: "enum",
    enum: [...PROJECT_TYPES],
    prompt: "What kind of project is this?"
  },
  {
    id: "target_users",
    type: "string",
    prompt: "Who is this for? (primary audience)"
  },
  {
    id: "primary_use_cases",
    type: "multi",
    enum: [
      "data-entry",
      "reporting",
      "integration",
      "automation",
      "collaboration",
      "other"
    ],
    prompt: "Primary use cases (comma-separated; pick from the listed values)"
  },
  {
    id: "success_criteria",
    type: "string",
    prompt: "How will you know this project succeeded? (one sentence)"
  },
  // TASK-036 — optional per-agent model overrides. `required: false` allows
  // the user to skip by pressing Enter; skipping writes NO agent_models key to
  // PROJECT.md. Defaults: reviewer=inherit, developer=sonnet, researcher=sonnet.
  // A non-empty answer must be comma/space-separated agent=model pairs; the
  // validate hook rejects malformed pairs, unknown agents, and invalid model
  // values with an error naming the offender (the engine re-prompts).
  {
    id: "agent_models",
    type: "string",
    required: false,
    prompt: "Per-agent model overrides (optional, e.g. reviewer=opus developer=haiku).\nDefaults: reviewer=inherit, developer=sonnet, researcher=sonnet.\nPress Enter to keep defaults (writes no agent_models key)",
    validate(value) {
      if (typeof value !== "string" || value.trim().length === 0) return null;
      try {
        parseAgentModelsAnswer(value);
        return null;
      } catch (err) {
        return err.message;
      }
    }
  }
]);
var AGENT_MODEL_ALIASES = /* @__PURE__ */ new Set(["sonnet", "opus", "haiku", "fable", "inherit"]);
var AGENT_MODEL_FULL_ID_RE = /^claude-[a-z0-9-]+$/;
var AGENT_MODEL_AGENTS = /* @__PURE__ */ new Set(["reviewer", "developer", "researcher"]);
function parseAgentModelsAnswer(raw) {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed.length === 0) {
    throw new Error("agent_models answer is empty \u2014 nothing to parse");
  }
  const out = {};
  const tokens = trimmed.split(/[\s,]+/).filter((t) => t.length > 0);
  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq === -1) {
      throw new Error(
        `malformed agent=model pair "${token}" \u2014 expected e.g. reviewer=opus`
      );
    }
    const agent = token.slice(0, eq).trim();
    const model = token.slice(eq + 1).trim();
    if (!AGENT_MODEL_AGENTS.has(agent)) {
      throw new Error(
        `unknown agent name "${agent}" \u2014 valid agents: ${[...AGENT_MODEL_AGENTS].join(", ")}`
      );
    }
    if (!AGENT_MODEL_ALIASES.has(model) && !AGENT_MODEL_FULL_ID_RE.test(model)) {
      throw new Error(
        `invalid model value "${model}" for agent "${agent}" \u2014 must be one of ${[...AGENT_MODEL_ALIASES].join(", ")} or a full model ID matching /^claude-[a-z0-9-]+$/`
      );
    }
    if (Object.prototype.hasOwnProperty.call(out, agent)) {
      throw new Error(`duplicate agent "${agent}" in agent_models answer`);
    }
    out[agent] = model;
  }
  return out;
}
function whenType(type) {
  return (a) => a.project_type === type;
}
var WEB_SAAS = [
  {
    id: "frontend_framework",
    type: "enum",
    enum: ["react", "vue", "svelte", "angular", "other"],
    prompt: "Which frontend framework?",
    when: whenType("web-saas")
  },
  {
    id: "backend_framework",
    type: "enum",
    enum: ["node-express", "node-fastify", "fastapi", "django", "rails", "go", "other"],
    prompt: "Which backend framework?",
    when: whenType("web-saas")
  },
  {
    id: "database",
    type: "enum",
    enum: ["postgres", "mysql", "sqlite", "mongodb", "dynamodb", "other"],
    prompt: "Which primary datastore?",
    when: whenType("web-saas")
  },
  {
    id: "web_deployment_target",
    type: "enum",
    enum: ["fly-io", "vercel", "aws", "gcp", "azure", "self-host", "other"],
    prompt: "Where will the web app run?",
    when: whenType("web-saas")
  }
];
var CLI_TOOL = [
  {
    id: "cli_language",
    type: "enum",
    enum: ["node", "python", "go", "rust", "other"],
    prompt: "Which language for the CLI?",
    when: whenType("cli-tool")
  },
  {
    id: "distribution_channel",
    type: "enum",
    enum: ["npm", "pypi", "homebrew", "github-release", "other"],
    prompt: "How will users install the CLI?",
    when: whenType("cli-tool")
  },
  {
    id: "command_structure",
    type: "enum",
    enum: ["single-command", "subcommands", "interactive-repl"],
    prompt: "Command surface shape?",
    when: whenType("cli-tool")
  }
];
var DATA_PIPELINE = [
  {
    id: "data_sources",
    type: "string",
    prompt: "Where does the data come from? (e.g. S3, Postgres, Kafka)",
    when: whenType("data-pipeline")
  },
  {
    id: "processing_framework",
    type: "enum",
    enum: ["airflow", "prefect", "dagster", "spark", "pandas", "dbt", "other"],
    prompt: "Which processing framework?",
    when: whenType("data-pipeline")
  },
  {
    id: "output_destinations",
    type: "string",
    prompt: "Where does processed data land? (e.g. warehouse, S3, API)",
    when: whenType("data-pipeline")
  }
];
var ML_MODEL = [
  {
    id: "model_family",
    type: "enum",
    enum: ["classical", "deep-learning", "transformer-llm", "other"],
    prompt: "Which model family?",
    when: whenType("ml-model")
  },
  {
    id: "ml_data_source",
    type: "string",
    prompt: "Where does the training data come from?",
    when: whenType("ml-model")
  },
  {
    id: "training_approach",
    type: "enum",
    enum: ["from-scratch", "fine-tune", "prompt-only", "other"],
    prompt: "Training approach?",
    when: whenType("ml-model")
  },
  {
    id: "ml_deployment_target",
    type: "enum",
    enum: ["batch", "online-api", "edge", "notebook-only", "other"],
    prompt: "How will the model be served?",
    when: whenType("ml-model")
  }
];
var LIBRARY = [
  {
    id: "library_language",
    type: "enum",
    enum: ["javascript", "typescript", "python", "go", "rust", "other"],
    prompt: "Which language for the library?",
    when: whenType("library")
  },
  {
    id: "audience",
    type: "string",
    prompt: "Who consumes the library? (e.g. internal teams, public)",
    when: whenType("library")
  },
  {
    id: "package_manager",
    type: "enum",
    enum: ["npm", "pypi", "cargo", "go-modules", "other"],
    prompt: "Which package registry?",
    when: whenType("library")
  }
];
var OTHER = [
  {
    id: "architecture_description",
    type: "string",
    prompt: "Describe the architecture in a sentence or two",
    when: whenType("other")
  }
];
var TYPE_SPECIFIC_QUESTIONS = Object.freeze({
  "web-saas": WEB_SAAS,
  "cli-tool": CLI_TOOL,
  "data-pipeline": DATA_PIPELINE,
  "ml-model": ML_MODEL,
  "library": LIBRARY,
  "other": OTHER
});
function buildIntakeQuestions() {
  const out = [...COMMON_QUESTIONS];
  for (const type of PROJECT_TYPES) {
    out.push(...TYPE_SPECIFIC_QUESTIONS[type]);
  }
  return out;
}

// src/project-md.js
var import_promises = require("node:fs/promises");
var import_node_fs7 = require("node:fs");
var import_node_path5 = require("node:path");

// src/intake-sanitizer.js
var TAG_BLOCK_START = 917504;
var TAG_BLOCK_END = 917631;
var FORMAT_CHAR_RE = new RegExp("\\p{Cf}", "u");
function isStrippableControlCodePoint(codePoint) {
  if (codePoint === 9 || codePoint === 10 || codePoint === 13) return false;
  if (codePoint <= 31) return true;
  if (codePoint >= 127 && codePoint <= 159) return true;
  if (codePoint >= TAG_BLOCK_START && codePoint <= TAG_BLOCK_END) return true;
  return false;
}
function stripInvisibleChars(value) {
  if (typeof value !== "string" || value.length === 0) return value;
  let out = "";
  for (const ch of value) {
    const codePoint = ch.codePointAt(0);
    if (isStrippableControlCodePoint(codePoint)) continue;
    if (FORMAT_CHAR_RE.test(ch)) continue;
    out += ch;
  }
  return out;
}
function sanitizeInvisibleCharsDeep(value) {
  if (typeof value === "string") return stripInvisibleChars(value);
  if (Array.isArray(value)) return value.map(sanitizeInvisibleCharsDeep);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = sanitizeInvisibleCharsDeep(v);
    }
    return out;
  }
  return value;
}
var ATX_HEADING_RE = /^( {0,3})(#{1,6})(\s|$)/;
var CODE_FENCE_RE = /^( {0,3})(`{3,}|~{3,})/;
var SETEXT_OR_BREAK_RE = /^( {0,3})([=\-*_])(?:[ \t]*\2)*[ \t]*$/;
function rejectControlChars(value, label) {
  if (typeof value === "string" && /[\r\n]/.test(value)) {
    throw new Error(
      `${label} must not contain newline or carriage-return characters \u2014 they would let the value escape its single-line Stack bullet and forge arbitrary new lines/headings/fences (control-character injection)`
    );
  }
}
function escapeStructuralLine(line) {
  const h = line.match(ATX_HEADING_RE);
  if (h) {
    const idx = h[1].length;
    return line.slice(0, idx) + "\\" + line.slice(idx);
  }
  const f = line.match(CODE_FENCE_RE);
  if (f) {
    const idx = f[1].length;
    return line.slice(0, idx) + "\\" + line.slice(idx);
  }
  const s = line.match(SETEXT_OR_BREAK_RE);
  if (s) {
    const idx = s[1].length;
    return line.slice(0, idx) + "\\" + line.slice(idx);
  }
  return line;
}
function escapeMarkdownStructure(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  return text.split(/\r?\n/).map(escapeStructuralLine).join("\n");
}
function renderBulletLines(item) {
  const lines = String(item).split(/\r?\n/).map(escapeStructuralLine);
  const out = [`- ${lines[0]}`];
  for (let i = 1; i < lines.length; i++) {
    out.push(lines[i].length === 0 ? "" : `  ${lines[i]}`);
  }
  return out;
}

// state/PROJECT.schema.json
var PROJECT_schema_default = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://hivemind.local/state/PROJECT.schema.json",
  title: "PROJECT.md frontmatter",
  description: "Machine-readable subset of the project-intake answers persisted in PROJECT.md frontmatter. The body of PROJECT.md is human prose and intentionally out of scope of this schema.",
  type: "object",
  additionalProperties: false,
  required: ["name", "type", "created_at", "schema_version"],
  properties: {
    name: {
      type: "string",
      minLength: 1
    },
    type: {
      type: "string",
      enum: ["web-saas", "cli-tool", "data-pipeline", "ml-model", "library", "other"]
    },
    created_at: {
      type: "string",
      format: "date-time"
    },
    schema_version: {
      type: "integer",
      const: 1
    },
    agent_models: {
      type: "object",
      additionalProperties: false,
      properties: {
        reviewer: {
          anyOf: [
            { type: "string", enum: ["sonnet", "opus", "haiku", "fable", "inherit"] },
            { type: "string", pattern: "^claude-[a-z0-9-]+$" }
          ]
        },
        developer: {
          anyOf: [
            { type: "string", enum: ["sonnet", "opus", "haiku", "fable", "inherit"] },
            { type: "string", pattern: "^claude-[a-z0-9-]+$" }
          ]
        },
        researcher: {
          anyOf: [
            { type: "string", enum: ["sonnet", "opus", "haiku", "fable", "inherit"] },
            { type: "string", pattern: "^claude-[a-z0-9-]+$" }
          ]
        }
      }
    },
    problem_statement: {
      type: "string"
    },
    goals: {
      type: "array",
      items: { type: "string" }
    },
    scope_in: {
      type: "array",
      items: { type: "string" }
    },
    scope_out: {
      type: "array",
      items: { type: "string" }
    },
    preview_command: {
      type: "string"
    },
    preview_url: {
      type: "string"
    },
    preview_port: {
      type: "string"
    },
    preview_mode: {
      type: "string",
      enum: ["web", "process"]
    },
    tier: {
      type: "string",
      enum: ["LIGERO", "MEDIO", "COMPLETO"]
    },
    perfil_proyecto: {
      type: "object",
      additionalProperties: { type: "string" }
    }
  }
};

// src/project-md.js
var PROJECT_MD = "PROJECT.md";
var SCHEMA_VERSION = 1;
var FRONTMATTER_SCHEMA = PROJECT_schema_default && PROJECT_schema_default.properties ? PROJECT_schema_default : { ...PROJECT_schema_default || {}, properties: {} };
var BODY_SECTIONS = [
  { id: "project_description", heading: "Description", bullets: false },
  { id: "target_users", heading: "Target users", bullets: false },
  { id: "primary_use_cases", heading: "Primary use cases", bullets: true },
  { id: "success_criteria", heading: "Success criteria", bullets: false },
  { id: "problem_statement", heading: "Problem", bullets: false },
  { id: "goals", heading: "Goals", bullets: true },
  { id: "scope_in", heading: "Scope (in)", bullets: true },
  { id: "scope_out", heading: "Scope (out)", bullets: true }
];
var FRONTMATTER_IDS = /* @__PURE__ */ new Set(["project_name", "project_type", "tier"]);
var SPECIAL_FRONTMATTER_IDS = /* @__PURE__ */ new Set(["agent_models", "perfil_proyecto"]);
var MODEL_ALIASES = /* @__PURE__ */ new Set(["sonnet", "opus", "haiku", "fable", "inherit"]);
var FULL_MODEL_ID_RE = /^claude-[a-z0-9-]+$/;
var VALID_AGENT_NAMES = /* @__PURE__ */ new Set(["reviewer", "developer", "researcher"]);
async function writeProjectMd({ repoRoot, answers, now = () => (/* @__PURE__ */ new Date()).toISOString() }) {
  answers = sanitizeInvisibleCharsDeep(answers ?? {});
  const requiredFrontmatterAnswers = ["project_name", "project_type"];
  for (const id of requiredFrontmatterAnswers) {
    const v = answers ? answers[id] : void 0;
    if (v === void 0 || v === null || v === "") {
      throw new Error(`writeProjectMd: missing required answer: ${id}`);
    }
  }
  for (const id of ["project_name", "project_type", "tier"]) {
    const v = answers[id];
    if (typeof v === "string" && /[\r\n]/.test(v)) {
      throw new Error(
        `writeProjectMd: ${id} must not contain newline or carriage-return characters \u2014 they would corrupt the PROJECT.md YAML frontmatter (control-character injection)`
      );
    }
  }
  const am = answers ? answers.agent_models : void 0;
  if (am !== void 0 && am !== null) {
    if (typeof am !== "object" || Array.isArray(am)) {
      throw new Error(
        `writeProjectMd: agent_models must be an object map of agent \u2192 model (got ${typeof am})`
      );
    }
    for (const [agent, model] of Object.entries(am)) {
      if (!VALID_AGENT_NAMES.has(agent)) {
        throw new Error(
          `writeProjectMd: invalid agent_models key "${agent}" \u2014 valid agents: ${[...VALID_AGENT_NAMES].join(", ")}`
        );
      }
      if (typeof model !== "string" || !MODEL_ALIASES.has(model) && !FULL_MODEL_ID_RE.test(model)) {
        throw new Error(
          `writeProjectMd: invalid agent_models value "${model}" for agent "${agent}" \u2014 must be one of ${[...MODEL_ALIASES].join(", ")} or match /^claude-[a-z0-9-]+$/`
        );
      }
    }
  }
  const pp = answers.perfil_proyecto;
  if (pp && typeof pp === "object" && !Array.isArray(pp)) {
    for (const [k, v] of Object.entries(pp)) {
      rejectControlChars(k, `perfil_proyecto key "${k}"`);
      rejectControlChars(typeof v === "string" ? v : String(v), `perfil_proyecto value for "${k}"`);
    }
  }
  const target = (0, import_node_path5.join)(repoRoot, PROJECT_MD);
  const createdAt = now();
  const body = renderProjectMd(answers, createdAt);
  await atomicWriteFile(target, body);
  return { path: target };
}
async function readProjectMd({ repoRoot }) {
  const target = (0, import_node_path5.join)(repoRoot, PROJECT_MD);
  if (!(0, import_node_fs7.existsSync)(target)) {
    throw new Error(`PROJECT.md not found at ${target}`);
  }
  const text = await (0, import_promises.readFile)(target, "utf8");
  return parseProjectMd(text);
}
function renderProjectMd(answers, createdAt) {
  const name = answers.project_name ?? "";
  const type = answers.project_type ?? "";
  const fmLines = [
    "---",
    `name: ${name}`,
    `type: ${type}`,
    `created_at: ${createdAt}`,
    `schema_version: ${SCHEMA_VERSION}`
  ];
  if (answers.agent_models && typeof answers.agent_models === "object" && Object.keys(answers.agent_models).length > 0) {
    const mapStr = Object.entries(answers.agent_models).map(([k, v]) => `${encodeMapEntry(String(k))}: ${encodeMapEntry(String(v))}`).join(", ");
    fmLines.push(`agent_models: {${mapStr}}`);
  }
  if (answers.tier !== void 0 && answers.tier !== null && answers.tier !== "") {
    fmLines.push(`tier: ${answers.tier}`);
  }
  if (answers.perfil_proyecto && typeof answers.perfil_proyecto === "object" && Object.keys(answers.perfil_proyecto).length > 0) {
    const profileStr = Object.entries(answers.perfil_proyecto).map(([k, v]) => `${encodeMapEntry(String(k))}: ${encodeMapEntry(String(v))}`).join(", ");
    fmLines.push(`perfil_proyecto: {${profileStr}}`);
  }
  fmLines.push("---", "");
  const out = [...fmLines, `# ${name}`, ""];
  for (const sec of BODY_SECTIONS) {
    if (!Object.prototype.hasOwnProperty.call(answers, sec.id)) continue;
    const value = answers[sec.id];
    if (sec.bullets) {
      const items = Array.isArray(value) ? value : [value];
      if (items.length === 0) continue;
      out.push(`## ${sec.heading}`);
      for (const item of items) {
        out.push(...renderBulletLines(item));
      }
    } else {
      const str = String(value);
      if (str.length === 0) continue;
      out.push(`## ${sec.heading}`);
      out.push(escapeMarkdownStructure(str));
    }
    out.push("");
  }
  const consumed = /* @__PURE__ */ new Set([
    ...FRONTMATTER_IDS,
    ...SPECIAL_FRONTMATTER_IDS,
    ...BODY_SECTIONS.map((s) => s.id)
  ]);
  const stackKeys = Object.keys(answers).filter(
    (k) => !consumed.has(k) && answers[k] !== null && answers[k] !== void 0
  );
  if (stackKeys.length > 0) {
    out.push("## Stack");
    for (const key of stackKeys) {
      rejectControlChars(key, `Stack key "${key}"`);
      const rawValue = answers[key];
      const valuesToCheck = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const v of valuesToCheck) {
        rejectControlChars(typeof v === "string" ? v : String(v), `Stack value for "${key}"`);
      }
      out.push(`- ${key}: ${formatStackValue(rawValue)}`);
    }
    out.push("");
  }
  return out.join("\n");
}
function formatStackValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((v) => encodeArrayItem(String(v))).join(", ")}]`;
  }
  return String(value);
}
function encodeArrayItem(s) {
  return s.replace(/\\/g, "\\\\").replace(/,/g, "\\,");
}
function decodeArrayItem(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) {
      const next = s[i + 1];
      if (next === "\\") {
        out += "\\";
        i++;
        continue;
      }
      if (next === ",") {
        out += ",";
        i++;
        continue;
      }
      out += "\\";
      continue;
    }
    out += ch;
  }
  return out;
}
function encodeMapEntry(s) {
  return s.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}
function decodeMapEntry(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) {
      const next = s[i + 1];
      if (next === "\\" || next === "," || next === "{" || next === "}") {
        out += next;
        i++;
        continue;
      }
      out += "\\";
      continue;
    }
    out += ch;
  }
  return out;
}
function splitInlineMapPairs(inner) {
  const pairs = [];
  let buf = "";
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === "\\" && i + 1 < inner.length) {
      buf += ch + inner[i + 1];
      i += 2;
      continue;
    }
    if (ch === ",") {
      pairs.push(buf);
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  pairs.push(buf);
  return pairs;
}
function splitInlineArray(inner) {
  const items = [];
  let buf = "";
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === "\\" && i + 1 < inner.length) {
      buf += ch + inner[i + 1];
      i += 2;
      continue;
    }
    if (ch === ",") {
      items.push(buf);
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  items.push(buf);
  return items.map((s) => decodeArrayItem(s.trim()));
}
function parseProjectMd(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") {
    throw new Error('PROJECT.md is missing the opening "---" frontmatter delimiter');
  }
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    throw new Error('PROJECT.md frontmatter has no closing "---" delimiter');
  }
  const fmLines = lines.slice(1, closeIdx);
  const frontmatter = parseFrontmatter(fmLines);
  const bodyLines = lines.slice(closeIdx + 1);
  const sections = parseBodySections(bodyLines);
  const answers = {};
  if (frontmatter.name !== void 0) answers.project_name = frontmatter.name;
  if (frontmatter.type !== void 0) answers.project_type = frontmatter.type;
  if (frontmatter.created_at !== void 0) answers.created_at = frontmatter.created_at;
  if (frontmatter.schema_version !== void 0) answers.schema_version = frontmatter.schema_version;
  if (frontmatter.agent_models !== void 0 && frontmatter.agent_models !== null && typeof frontmatter.agent_models === "object" && Object.keys(frontmatter.agent_models).length > 0) {
    answers.agent_models = frontmatter.agent_models;
  }
  if (frontmatter.tier !== void 0) answers.tier = frontmatter.tier;
  if (frontmatter.perfil_proyecto !== void 0 && frontmatter.perfil_proyecto !== null && typeof frontmatter.perfil_proyecto === "object" && Object.keys(frontmatter.perfil_proyecto).length > 0) {
    answers.perfil_proyecto = frontmatter.perfil_proyecto;
  }
  for (const sec of BODY_SECTIONS) {
    const block = sections.get(sec.heading);
    if (block === void 0) continue;
    if (sec.bullets) {
      answers[sec.id] = parseBullets(block);
    } else {
      const joined = block.join("\n").trim();
      if (joined.length > 0) {
        answers[sec.id] = joined;
      }
    }
  }
  const stack = sections.get("Stack");
  if (stack !== void 0) {
    for (const line of stack) {
      const m = line.match(/^-\s+([^:]+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      if (SPECIAL_FRONTMATTER_IDS.has(key)) continue;
      const rawValue = m[2].trim();
      answers[key] = parseStackValue(rawValue);
    }
  }
  return { answers, frontmatter };
}
function parseFrontmatter(fmLines) {
  const out = {};
  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i];
    if (line.trim().length === 0) continue;
    if (/^\s+\S/.test(line)) {
      throw new Error(
        "PROJECT.md frontmatter contains an indented (nested) line; nested objects are unsupported by the in-house yaml subset"
      );
    }
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) {
      throw new Error(
        `PROJECT.md frontmatter line is not a recognized scalar/array entry: ${JSON.stringify(line)}`
      );
    }
    const key = m[1];
    const rawValue = m[2];
    if (rawValue.length === 0) {
      const next = fmLines[i + 1];
      if (next !== void 0 && /^\s+\S/.test(next)) {
        throw new Error(
          `PROJECT.md frontmatter key "${key}" appears to introduce a nested object; nested yaml is unsupported by the in-house parser`
        );
      }
      out[key] = "";
      continue;
    }
    out[key] = coerceFrontmatterScalar(rawValue, key);
  }
  return out;
}
function coerceFrontmatterScalar(raw, fieldName) {
  if (SPECIAL_FRONTMATTER_IDS.has(fieldName) && raw.startsWith("{") && raw.endsWith("}")) {
    const inner = raw.slice(1, -1).trim();
    if (inner.length === 0) return {};
    const result = {};
    for (const pair of splitInlineMapPairs(inner)) {
      const colonIdx = pair.indexOf(":");
      if (colonIdx === -1) {
        throw new Error(
          `PROJECT.md frontmatter ${fieldName} entry ${JSON.stringify(pair.trim())} is missing a colon \u2014 expected the form {key: value, ...}`
        );
      }
      const k = decodeMapEntry(pair.slice(0, colonIdx).trim());
      const v = decodeMapEntry(pair.slice(colonIdx + 1).trim());
      if (k.length > 0 && v.length > 0) result[k] = v;
    }
    return result;
  }
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return splitInlineArray(inner);
  }
  if (/^-?\d+$/.test(raw)) {
    const declared = FRONTMATTER_SCHEMA.properties?.[fieldName]?.type;
    if (declared === "integer" || declared === "number") {
      return Number(raw);
    }
  }
  return raw;
}
function parseBodySections(bodyLines) {
  const sections = /* @__PURE__ */ new Map();
  let current = null;
  let buffer = [];
  for (const line of bodyLines) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      if (current !== null) sections.set(current, trimEdges(buffer));
      current = h[1];
      buffer = [];
      continue;
    }
    if (current !== null) buffer.push(line);
  }
  if (current !== null) sections.set(current, trimEdges(buffer));
  return sections;
}
function trimEdges(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim().length === 0) start++;
  while (end > start && lines[end - 1].trim().length === 0) end--;
  return lines.slice(start, end);
}
function parseBullets(blockLines) {
  const out = [];
  for (const line of blockLines) {
    const m = line.match(/^-\s+(.*)$/);
    if (m) out.push(m[1].trim());
  }
  return out;
}
function parseStackValue(raw) {
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return splitInlineArray(inner);
  }
  return raw;
}

// src/pack-hooks.js
function collectPackQuestions(coreQuestions, activePacks) {
  if (!Array.isArray(activePacks) || activePacks.length === 0) {
    return coreQuestions;
  }
  const seenIds = new Set(coreQuestions.map((q) => q.id));
  const combined = [...coreQuestions];
  for (const pack of activePacks) {
    const packId = pack && pack.descriptor && pack.descriptor.id;
    const questions = pack && pack.module && pack.module.questions || [];
    for (const q of questions) {
      if (seenIds.has(q.id)) {
        throw new Error(
          `collectPackQuestions: pack "${packId}" question id "${q.id}" collides with an existing question id (a core question, or a question already contributed by an earlier active pack) \u2014 pack question ids must be unique`
        );
      }
      seenIds.add(q.id);
      combined.push(q);
    }
  }
  return combined;
}
function applyProjectMdContributions(activePacks, answers) {
  const merged = { ...answers };
  if (!Array.isArray(activePacks) || activePacks.length === 0) {
    return merged;
  }
  for (const pack of activePacks) {
    const descriptor = pack && pack.descriptor || {};
    const packId = descriptor.id;
    const deriveFn = pack && pack.module && pack.module.deriveProjectMd;
    if (typeof deriveFn !== "function") continue;
    const result = deriveFn(answers) || {};
    const allowed = new Set(
      Array.isArray(descriptor.project_md_contribution) ? descriptor.project_md_contribution : []
    );
    const offending = Object.keys(result).filter((key) => !allowed.has(key));
    if (offending.length > 0) {
      throw new Error(
        `applyProjectMdContributions: pack "${packId}" derived key(s) ${JSON.stringify(offending)} outside its declared project_md_contribution ${JSON.stringify([...allowed])} \u2014 refusing to merge any field from this pack (all-or-nothing isolation)`
      );
    }
    Object.assign(merged, result);
  }
  return merged;
}

// src/pack-descriptor.js
var import__2 = __toESM(require__(), 1);
var import_ajv_formats2 = __toESM(require_dist(), 1);

// state/pack-descriptor.schema.json
var pack_descriptor_schema_default = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://hivemind.local/state/pack-descriptor.schema.json",
  title: "PackDescriptor",
  description: "Declarative shape of a Hivemind addon pack (docs/design/addon-packs.md \xA78). A pack is data: an intake trigger, an optional profiling interview, the resources (skills/mcp/plugins) it wires up with ownership metadata, the loop_auth gate scopes it introduces, and the pipeline steps it injects via the core registration hook. Wave-1 scope is descriptor validation only \u2014 the reconciler that acts on this data is a separate ticket.",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "name",
    "version",
    "core_compat",
    "trigger",
    "project_md_contribution",
    "profile",
    "resources",
    "gate_scopes",
    "pipeline"
  ],
  properties: {
    id: {
      type: "string",
      minLength: 1,
      description: "Stable pack identifier, e.g. 'design-power'."
    },
    name: {
      type: "string",
      minLength: 1,
      description: "Human-readable pack name."
    },
    version: {
      type: "string",
      minLength: 1,
      description: "Pack version (semver-exact recommended, not enforced here)."
    },
    core_compat: {
      type: "string",
      minLength: 1,
      description: "Compat range against the core registration hook API (addon-packs.md \xA75)."
    },
    trigger: {
      type: "object",
      description: "Intake condition that activates the pack. Shape is pack-defined (addon-packs.md \xA78); kept loose here since Wave 1 only validates the descriptor envelope."
    },
    project_md_contribution: {
      type: "array",
      items: { type: "string" },
      description: "PROJECT.md frontmatter keys this pack writes (the 'intent' side of the reconciler, addon-packs.md \xA72)."
    },
    profile: {
      type: "object",
      description: "Optional profiling interview + complexity scoring (addon-packs.md \xA78). Shape is pack-defined."
    },
    resources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "origin", "pin", "scope", "required"],
        properties: {
          id: {
            type: "string",
            minLength: 1,
            description: "Resource id, unique within this descriptor. Referenced by other resources' `fallback`."
          },
          kind: {
            type: "string",
            enum: ["skill", "mcp", "plugin"]
          },
          origin: {
            type: "string",
            minLength: 1,
            description: "Origin allowlist entry, e.g. 'vendor/repo-or-registry' (addon-packs-plan.md \xA72)."
          },
          pin: {
            type: "string",
            minLength: 1,
            description: "Exact commit SHA or semver \u2014 never a range (addon-packs-plan.md \xA72)."
          },
          scope: {
            type: "string",
            enum: ["project", "user"]
          },
          required: {
            type: "string",
            enum: ["hard", "soft"],
            description: "hard = blocks the loop on failure; soft = degrade and report (addon-packs.md \xA72.3)."
          },
          fallback: {
            type: "string",
            minLength: 1,
            description: "Id of another resource in this same descriptor's resources[] to fall back to when this one is soft-unavailable (addon-packs-plan.md \xA78). Validated as a semantic reference by the validator, not by this schema alone."
          },
          activate_when: {
            type: "string",
            minLength: 1,
            description: "OPTIONAL activation predicate over profile variables, e.g. 'tier>=MEDIO' or 'framework==vue && ui_outside_canvas' (addon-packs.md \xA78.1). Activation/exclusion is descriptor DATA -- this predicate plus `fallback` above -- never hardcoded core logic. TASK-123 only validates this as a non-empty string and round-trips it; predicate EVALUATION is deferred to the Phase D/F layer and is out of scope here."
          },
          install: {
            type: "string",
            minLength: 1,
            description: "OPTIONAL install command string for this resource, e.g. 'claude plugin add anthropic/frontend-design' (addon-packs.md \xA78). Data only -- no command is executed by this schema or by validatePackDescriptor."
          }
        }
      }
    },
    gate_scopes: {
      type: "array",
      items: { type: "string" },
      description: "loop_auth scopes this pack introduces (addon-packs.md \xA74)."
    },
    pipeline: {
      type: "array",
      items: { type: "string" },
      description: "Pipeline steps injected via the core registration hook (addon-packs.md \xA75)."
    }
  }
};

// src/pack-descriptor.js
var __ajv = new import__2.default({ allErrors: true, strict: false });
(0, import_ajv_formats2.default)(__ajv);
var __validate = __ajv.compile(pack_descriptor_schema_default);
function validatePackDescriptor(obj) {
  const ok = __validate(obj);
  const errors = ok ? [] : [...__validate.errors];
  if (obj && Array.isArray(obj.resources)) {
    const knownIds = new Set(
      obj.resources.map((resource) => resource && resource.id).filter((id) => typeof id === "string")
    );
    const idCounts = /* @__PURE__ */ new Map();
    for (const resource of obj.resources) {
      if (resource && typeof resource.id === "string") {
        idCounts.set(resource.id, (idCounts.get(resource.id) || 0) + 1);
      }
    }
    obj.resources.forEach((resource, index) => {
      if (resource && typeof resource.id === "string" && idCounts.get(resource.id) > 1) {
        errors.push({
          instancePath: `/resources/${index}/id`,
          message: `duplicate resource id "${resource.id}" \u2014 resource ids must be unique within a descriptor`
        });
      }
    });
    obj.resources.forEach((resource, index) => {
      if (!resource || typeof resource.fallback !== "string") return;
      if (resource.fallback === resource.id) {
        errors.push({
          instancePath: `/resources/${index}/fallback`,
          message: `must reference another resource id, not itself (got "${resource.fallback}")`
        });
      } else if (!knownIds.has(resource.fallback)) {
        errors.push({
          instancePath: `/resources/${index}/fallback`,
          message: `must reference an existing resource id in the same descriptor (got "${resource.fallback}")`
        });
      }
    });
  }
  return { valid: errors.length === 0, errors: errors.length ? errors : null };
}

// src/pack-registry.js
var HOOK_API_VERSION = "1.0.0";
function parseVersionParts(version) {
  const parts = String(version).trim().split(".").map((p) => Number.parseInt(p, 10));
  const [major, minor, patch] = parts;
  return [major || 0, minor || 0, patch || 0];
}
function compareVersions(a, b) {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}
var RANGE_PATTERN = /^\s*(>=|<=|>|<|=)?\s*(\d+(?:\.\d+){0,2})\s*$/;
function satisfiesCoreCompat(range, version) {
  if (typeof range !== "string") return false;
  const match = RANGE_PATTERN.exec(range);
  if (!match) return false;
  const [, operator = "=", target] = match;
  const cmp = compareVersions(version, target);
  switch (operator) {
    case ">=":
      return cmp >= 0;
    case ">":
      return cmp > 0;
    case "<=":
      return cmp <= 0;
    case "<":
      return cmp < 0;
    case "=":
      return cmp === 0;
    default:
      return false;
  }
}
function describeSkip(descriptor) {
  return descriptor && typeof descriptor.id === "string" ? descriptor.id : "<unknown>";
}
function resolveActivePacks(descriptors, hookApiVersion = HOOK_API_VERSION) {
  const candidates = Array.isArray(descriptors) ? descriptors : [];
  const active = [];
  const skipped = [];
  for (const descriptor of candidates) {
    const packId = describeSkip(descriptor);
    const validation = validatePackDescriptor(descriptor);
    if (!validation.valid) {
      skipped.push({
        pack_id: packId,
        reason: `invalid descriptor: ${JSON.stringify(validation.errors)}`
      });
      continue;
    }
    if (!satisfiesCoreCompat(descriptor.core_compat, hookApiVersion)) {
      skipped.push({
        pack_id: packId,
        reason: `core_compat "${descriptor.core_compat}" is not satisfied by HOOK_API_VERSION "${hookApiVersion}"`
      });
      continue;
    }
    active.push(descriptor);
  }
  active.sort((a, b) => {
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  return { active, skipped };
}

// src/pack-loader.js
function loadActivePacks({ descriptors = [], moduleRegistry = {}, hookApiVersion } = {}) {
  const { active, skipped } = hookApiVersion === void 0 ? resolveActivePacks(descriptors) : resolveActivePacks(descriptors, hookApiVersion);
  const activePacks = active.map((descriptor) => ({
    descriptor,
    module: moduleRegistry[descriptor.id] || {}
  }));
  return { activePacks, skipped };
}

// src/design-profile.js
var DESIGN_HEAVY_QUESTION = {
  id: "design_heavy",
  type: "enum",
  enum: ["yes", "no"],
  prompt: "Does this project have a visual, human-facing interface that needs deliberate design work \u2014 as opposed to a pure API, CLI, backend service, or script? (This decides whether the design-power pack engages at all.)"
};
var FASE_1_QUESTIONS = [
  {
    id: "estimated_screens",
    type: "number",
    prompt: "Roughly how many distinct user-facing screens/flows will this need at launch? (best estimate; a single-page tool = 1)",
    when: (a) => a.design_heavy === "yes"
  },
  {
    id: "stakes",
    type: "enum",
    enum: ["low", "real"],
    prompt: "What's the deployment reality? 'low' = personal project/prototype/experiment, no one depends on it working. 'real' = an internal team relies on it daily, or it has public/paying users and uptime matters.",
    when: (a) => a.design_heavy === "yes"
  },
  {
    id: "design_ambition",
    type: "enum",
    enum: ["utilitarian", "tidy", "branded", "signature"],
    prompt: "What visual bar does this need to hit? utilitarian = internal tool, just needs to be usable. tidy = clean and professional, generic is fine. branded = distinctive, competitive with polished products in its category. signature = best-in-class, art-directed, a differentiator in itself.",
    when: (a) => a.design_heavy === "yes"
  },
  {
    id: "ui_framework",
    type: "enum",
    enum: ["react", "vue", "other"],
    prompt: "Which framework renders the UI? (drives component-registry routing)",
    when: (a) => a.design_heavy === "yes"
  },
  {
    id: "has_canvas_render",
    type: "enum",
    enum: ["yes", "no"],
    prompt: "Does the project render through a canvas/game-engine surface (Phaser, WebGL, Three.js, etc.) rather than plain DOM?",
    when: (a) => a.design_heavy === "yes"
  },
  {
    id: "ui_outside_canvas",
    type: "enum",
    enum: ["yes", "no"],
    prompt: "Is there any DOM UI (HUD, menus, settings screens, overlays) outside that canvas?",
    when: (a) => a.design_heavy === "yes" && a.has_canvas_render === "yes"
  },
  {
    id: "motion_required",
    type: "enum",
    enum: ["yes", "no"],
    prompt: "Does this need real animation/motion work \u2014 transitions, micro-interactions, choreographed sequences \u2014 beyond basic hover states?",
    when: (a) => a.design_heavy === "yes"
  },
  {
    id: "motion_layer",
    type: "enum",
    enum: ["dom", "canvas", "both"],
    prompt: "Where does that motion primarily live?",
    when: (a) => a.design_heavy === "yes" && a.motion_required === "yes"
  },
  {
    id: "needs_research",
    type: "enum",
    enum: ["need-research", "have-direction"],
    prompt: "Do you need competitive/visual reference research (mood boards, competitor UI audits) before design starts, or do you already have clear direction (existing brand, mockups, style guide)?",
    when: (a) => a.design_heavy === "yes"
  },
  {
    id: "assets_required",
    type: "multi",
    enum: ["illustrations", "icons-custom", "photography", "3d-renders", "game-sprites-tiles", "none"],
    prompt: "Which custom visual assets does this need? (comma-separated; pick from the listed values)",
    when: (a) => a.design_heavy === "yes"
  }
];
var DESIGN_PROFILE_QUESTIONS = [DESIGN_HEAVY_QUESTION, ...FASE_1_QUESTIONS];
function bucketScreens(n) {
  const v = Number.isFinite(n) ? n : 1;
  if (v <= 2) return 0;
  if (v <= 7) return 1;
  if (v <= 20) return 2;
  return 3;
}
var DESIGN_AMBITION_SCORE = { utilitarian: 0, tidy: 1, branded: 2, signature: 3 };
function scoreComplexity(answers) {
  if (answers.design_heavy !== "yes") {
    return {
      tier: "LIGERO",
      score: 0,
      axes: { functionality: 0, beauty: 0 },
      activations: {
        design_heavy: false,
        framework: null,
        is_canvas: false,
        ui_outside_canvas: null,
        motion_required: false,
        motion_layer: null,
        needs_research: false,
        assets: false,
        assets_list: []
      }
    };
  }
  let F = bucketScreens(answers.estimated_screens);
  if (answers.stakes === "real" && F === 0) F = 1;
  F = Math.min(F, 3);
  const B = DESIGN_AMBITION_SCORE[answers.design_ambition] ?? 0;
  const fHigh = F >= 2;
  const bHigh = B >= 2;
  const tier = fHigh && bHigh ? "COMPLETO" : fHigh || bHigh ? "MEDIO" : "LIGERO";
  const score = F + B;
  const isCanvas = answers.has_canvas_render === "yes";
  const uiOutsideCanvas = isCanvas ? answers.ui_outside_canvas === "yes" : true;
  const motionRequired = answers.motion_required === "yes";
  const motionLayer = motionRequired ? answers.motion_layer ?? "dom" : null;
  const needsResearch = answers.needs_research === "need-research";
  const assetsList = Array.isArray(answers.assets_required) ? answers.assets_required.filter((a) => a !== "none") : [];
  return {
    tier,
    score,
    axes: { functionality: F, beauty: B },
    activations: {
      design_heavy: true,
      framework: answers.ui_framework ?? "other",
      is_canvas: isCanvas,
      ui_outside_canvas: uiOutsideCanvas,
      motion_required: motionRequired,
      motion_layer: motionLayer,
      needs_research: needsResearch,
      assets: assetsList.length > 0,
      assets_list: assetsList
    }
  };
}
function deriveProfileFields(answers) {
  const { tier, score, axes, activations } = scoreComplexity(answers);
  const raw = {
    score,
    functionality: axes.functionality,
    beauty: axes.beauty,
    design_heavy: activations.design_heavy,
    framework: activations.framework,
    is_canvas: activations.is_canvas,
    ui_outside_canvas: activations.ui_outside_canvas,
    motion_required: activations.motion_required,
    motion_layer: activations.motion_layer,
    needs_research: activations.needs_research,
    assets: activations.assets,
    assets_list: activations.assets_list.join("+")
  };
  const perfil_proyecto = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === void 0) continue;
    const str = String(value);
    if (str.length === 0) continue;
    if (str.includes(",") || str.includes("{") || str.includes("}")) {
      throw new Error(
        `deriveProfileFields: value for perfil_proyecto.${key} ("${str}") contains a comma or brace. project-md.js's inline-object encoding round-trips these losslessly via escaping, but this is outside the plain enum/number/boolean shapes deriveProfileFields is expected to emit \u2014 refusing to emit an unexpected value rather than silently trusting it`
      );
    }
    perfil_proyecto[key] = str;
  }
  return { tier, perfil_proyecto };
}

// packs/design-power/descriptor.json
var descriptor_default = {
  id: "design-power",
  name: "Dise\xF1o Poderoso",
  version: "0.1.0",
  core_compat: ">=1.0.0",
  trigger: {
    intake_question: "Does this project have a visual, human-facing interface that needs deliberate design work \u2014 as opposed to a pure API, CLI, backend service, or script? (This decides whether the design-power pack engages at all.)",
    activates_when: "design_heavy==yes"
  },
  project_md_contribution: ["perfil_proyecto", "tier"],
  profile: {},
  resources: [
    {
      id: "frontend-design",
      kind: "plugin",
      origin: "official Claude plugin marketplace (e.g. anthropics/claude-code frontend-design plugin)",
      pin: "marketplace-latest (Wave-2; human to ratify)",
      scope: "project",
      required: "hard",
      activate_when: "always (design_heavy)",
      install: "/plugin install frontend-design@<marketplace-pin-tbd> (Wave-2, TUI-only \u2014 human to ratify exact pin before autonomous install)"
    },
    {
      id: "ui-ux-pro-max",
      kind: "skill",
      origin: "github.com/nextlevelbuilder/ui-ux-pro-max-skill",
      pin: "12b486b22e67f5d887962ef8351c1ac863bfaeb9",
      scope: "project",
      required: "soft",
      activate_when: "tier != LIGERO",
      install: "vendor via assimilate (FP-5)"
    },
    {
      id: "shadcn/ui",
      kind: "mcp",
      origin: "shadcn CLI",
      pin: "4.13.0",
      scope: "project",
      required: "soft",
      activate_when: "framework==react && ui_outside_canvas",
      install: "claude mcp add shadcn -- npx shadcn@4.13.0 mcp"
    },
    {
      id: "shadcn-vue",
      kind: "mcp",
      origin: "shadcn-vue CLI",
      pin: "2.7.4",
      scope: "project",
      required: "soft",
      activate_when: "framework==vue && ui_outside_canvas",
      install: "npx shadcn-vue@2.7.4 mcp init --client claude"
    },
    {
      id: "firecrawl",
      kind: "mcp",
      origin: "firecrawl-mcp (Mendable)",
      pin: "3.22.3",
      scope: "project",
      required: "soft",
      activate_when: "needs_research",
      install: "claude mcp add firecrawl -e FIRECRAWL_API_KEY=<key> -- npx -y firecrawl-mcp@3.22.3"
    },
    {
      id: "playwright",
      kind: "mcp",
      origin: "@playwright/mcp (Microsoft)",
      pin: "0.0.77",
      scope: "project",
      required: "soft",
      activate_when: "tier==COMPLETO && ui_outside_canvas",
      install: "claude mcp add playwright -- npx @playwright/mcp@0.0.77"
    }
  ],
  gate_scopes: ["design_pipeline"],
  pipeline: [
    "reference",
    "research",
    "art-direction",
    "design-system",
    "implementation",
    "motion",
    "assets",
    "polish",
    "testing"
  ]
};

// src/builtin-packs.js
var DESIGN_POWER_DESCRIPTOR = descriptor_default;
function deriveProjectMdGated(answers) {
  if (!answers || answers.design_heavy !== "yes") return {};
  return deriveProfileFields(answers);
}
var DESIGN_POWER_MODULE = {
  questions: DESIGN_PROFILE_QUESTIONS,
  deriveProjectMd: deriveProjectMdGated
};
var BUILTIN_PACK_DESCRIPTORS = [DESIGN_POWER_DESCRIPTOR];
var BUILTIN_PACK_MODULES = { [DESIGN_POWER_DESCRIPTOR.id]: DESIGN_POWER_MODULE };

// src/agent-generator.js
var import_node_fs8 = require("node:fs");
var import_node_path6 = require("node:path");
var PROJECT_CONTEXT_REL = [".claude", "agents", "project-context.md"];
var SCHEMA_VERSION2 = 1;
var FRONTMATTER_IDS2 = /* @__PURE__ */ new Set(["project_name", "project_type"]);
var ROUNDTRIP_NOISE_IDS = /* @__PURE__ */ new Set([
  "project_description",
  "target_users",
  "primary_use_cases",
  "success_criteria",
  "created_at",
  "schema_version",
  // TASK-036 — agent_models is project config, not a stack entry.
  "agent_models",
  // TASK-045 — definition fields are rendered in their own ## Problem section
  // below; they must not appear as Stack bullets.
  "problem_statement",
  "goals",
  "scope_in",
  "scope_out"
]);
var TYPE_SPECIFIC_GUIDANCE = Object.freeze({
  "web-saas": [
    "Treat the browser and the backend as separate trust boundaries \u2014 never assume client-supplied data is well-formed at HTTP entry points.",
    "Reach for end-to-end tests sparingly; cover routing and frontend state-transition logic with focused integration tests at the boundary.",
    "Sessions and auth tokens are sensitive \u2014 never log them, and isolate any HTTP middleware that touches them behind a small, reviewable surface.",
    "Performance budgets matter: measure both server latency and browser time-to-interactive when changing data-fetch patterns."
  ],
  "cli-tool": [
    "Treat stdin, stdout, and stderr as the public API \u2014 output schema changes are breaking changes for downstream piped consumers.",
    "Exit codes carry contract weight: 0 means success, non-zero means failure, and the specific code should be stable across releases.",
    "Detect whether the process attaches to a TTY before emitting color or progress UI \u2014 non-interactive shells need plain, parseable output.",
    "Validate argv shape early and fail with a one-line usage hint rather than a stack trace; users see only what is printed."
  ],
  "data-pipeline": [
    "Distinguish batch and stream execution paths explicitly \u2014 they have different failure semantics and different idempotency guarantees.",
    "Schema validation belongs at the ingest boundary; a malformed row should be quarantined, not silently coerced downstream.",
    "Idempotent writes are non-negotiable for any step that can be retried \u2014 design every sink around upsert-by-key, not blind append.",
    "Watch throughput and per-stage latency; a 10x slowdown in one stage often hides a schema drift or a runaway upstream source."
  ],
  "ml-model": [
    "Pin the dataset version alongside the model version \u2014 reproducibility is the metric that makes every other metric trustworthy.",
    "Notebook experiments are exploratory by nature; promote any reusable transform out of the notebook before it becomes load-bearing.",
    "Evaluation metrics should be computed on a held-out split that the training loop has never observed, including during hyperparameter search.",
    "Document the eval harness: which split, which metric, which baseline. A model without a recorded baseline is a model without a verdict."
  ],
  "library": [
    "Treat every exported symbol as part of the public API \u2014 adding one is cheap, removing or renaming one is a semver-major change.",
    "Backwards compatibility is a feature, not an afterthought. Deprecate first, remove later, and document the migration path in the changelog.",
    "Consumer-facing types and error shapes are part of the contract; widening a return type is fine, narrowing it is breaking.",
    "Avoid runtime dependencies wherever a small built-in alternative exists \u2014 every transitive dep is something a consumer inherits."
  ],
  "other": [
    "No project-type-specific assumptions apply \u2014 default to conservative, generic engineering practice until the stack reveals itself.",
    "Stack details were left unspecified at intake; ask the human (or update PROJECT.md) before making non-trivial architectural decisions.",
    "Prefer the simplest tool that solves the problem; do not import a framework when a 20-line helper would do.",
    "When in doubt, write the test first \u2014 the unspecified domain is exactly the case where tests pin down intent fastest."
  ]
});
async function generateProjectContext({
  repoRoot,
  answers,
  now = () => (/* @__PURE__ */ new Date()).toISOString()
}) {
  let resolvedAnswers = answers;
  if (resolvedAnswers === void 0 || resolvedAnswers === null) {
    const projectMdPath = (0, import_node_path6.join)(repoRoot, "PROJECT.md");
    try {
      const parsed = await readProjectMd({ repoRoot });
      resolvedAnswers = parsed.answers;
    } catch (err) {
      throw new Error(
        `generateProjectContext: cannot read PROJECT.md at ${projectMdPath} (supply an explicit answers argument or run the init wizard first) \u2014 ${err.message}`
      );
    }
  }
  resolvedAnswers = sanitizeInvisibleCharsDeep(resolvedAnswers ?? {});
  const target = (0, import_node_path6.join)(repoRoot, ...PROJECT_CONTEXT_REL);
  (0, import_node_fs8.mkdirSync)((0, import_node_path6.dirname)(target), { recursive: true });
  const body = renderProjectContext(resolvedAnswers, now());
  await atomicWriteFile(target, body);
  return { path: target };
}
function renderProjectContext(answers, generatedAt) {
  const projectName = answers.project_name ?? "";
  const projectType = answers.project_type ?? "other";
  const out = [];
  out.push("---");
  out.push(`project_name: ${projectName}`);
  out.push(`project_type: ${projectType}`);
  out.push(`generated_at: ${generatedAt}`);
  out.push(`schema_version: ${SCHEMA_VERSION2}`);
  out.push("---");
  out.push("");
  const hasProblem = answers.problem_statement && String(answers.problem_statement).length > 0;
  const hasGoals = Array.isArray(answers.goals) && answers.goals.length > 0;
  const hasScopeIn = Array.isArray(answers.scope_in) && answers.scope_in.length > 0;
  const hasScopeOut = Array.isArray(answers.scope_out) && answers.scope_out.length > 0;
  if (hasProblem || hasGoals || hasScopeIn || hasScopeOut) {
    out.push("## Problem");
    if (hasProblem) {
      out.push(escapeMarkdownStructure(String(answers.problem_statement)));
      out.push("");
    }
    if (hasGoals) {
      out.push("### Goals");
      for (const g of answers.goals) out.push(...renderBulletLines(g));
      out.push("");
    }
    if (hasScopeIn) {
      out.push("### Scope (in)");
      for (const s of answers.scope_in) out.push(...renderBulletLines(s));
      out.push("");
    }
    if (hasScopeOut) {
      out.push("### Scope (out)");
      for (const s of answers.scope_out) out.push(...renderBulletLines(s));
      out.push("");
    }
  }
  out.push("## Stack");
  const stackEntries = [];
  for (const [key, value] of Object.entries(answers)) {
    if (FRONTMATTER_IDS2.has(key)) continue;
    if (ROUNDTRIP_NOISE_IDS.has(key)) continue;
    stackEntries.push([key, value]);
  }
  if (stackEntries.length === 0) {
    out.push("- (none specified)");
  } else {
    for (const [key, value] of stackEntries) {
      rejectControlChars(key, `Stack key "${key}"`);
      const valuesToCheck = Array.isArray(value) ? value : [value];
      for (const v of valuesToCheck) {
        rejectControlChars(typeof v === "string" ? v : String(v), `Stack value for "${key}"`);
      }
      out.push(`- ${key}: ${formatStackValue2(value)}`);
    }
  }
  out.push("");
  out.push("## Testing conventions");
  out.push(
    "Use the testing tool that fits this stack \u2014 the project standard is to keep a fast unit suite runnable via the project's default test command, and to write a failing test before any new behavior lands. Tests live next to the code they exercise (or under a top-level tests/ tree, whichever already exists in this repo); follow the local convention rather than introducing a new one."
  );
  out.push("");
  out.push("## Linting and formatting");
  out.push(
    "Run the project's linter and formatter before every commit. If the repo ships a config (e.g., .eslintrc, ruff.toml, .prettierrc, gofmt defaults), defer to it without arguing; if no config exists yet, use the ecosystem-standard tool and add a minimal config rather than reformatting the whole tree in a drive-by change."
  );
  out.push("");
  out.push("## Type-specific guidance");
  const bullets = TYPE_SPECIFIC_GUIDANCE[projectType] ?? TYPE_SPECIFIC_GUIDANCE["other"];
  for (const bullet of bullets) {
    out.push(`- ${bullet}`);
  }
  out.push("");
  return out.join("\n");
}
function formatStackValue2(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v)).join(", ");
  }
  return String(value);
}
var VALID_MODEL_ALIASES = /* @__PURE__ */ new Set(["sonnet", "opus", "haiku", "fable", "inherit"]);
var VALID_FULL_MODEL_ID_RE = /^claude-[a-z0-9-]+$/;
var VALID_AGENT_NAMES_FOR_APPLY = /* @__PURE__ */ new Set(["reviewer", "developer", "researcher"]);
async function applyAgentModels({ repoRoot, agentModels }) {
  for (const [agentName, modelValue] of Object.entries(agentModels)) {
    if (!VALID_AGENT_NAMES_FOR_APPLY.has(agentName)) {
      throw new Error(
        `applyAgentModels: invalid/unknown agent name "${agentName}". Valid agent names are: ${[...VALID_AGENT_NAMES_FOR_APPLY].join(", ")}`
      );
    }
    if (!VALID_MODEL_ALIASES.has(modelValue) && !VALID_FULL_MODEL_ID_RE.test(modelValue)) {
      throw new Error(
        `applyAgentModels: invalid model value "${modelValue}" for agent "${agentName}". Must be one of ${[...VALID_MODEL_ALIASES].join(", ")} or match /^claude-[a-z0-9-]+$/`
      );
    }
  }
  const claudeAgentsDir = (0, import_node_path6.join)(repoRoot, ".claude", "agents");
  const parityAgentsDir = (0, import_node_path6.join)(repoRoot, "agents");
  const hasParityDir = (0, import_node_fs8.existsSync)(parityAgentsDir);
  const changedFiles = [];
  for (const [agentName, modelValue] of Object.entries(agentModels)) {
    const targets = [(0, import_node_path6.join)(claudeAgentsDir, `${agentName}.md`)];
    if (hasParityDir) {
      targets.push((0, import_node_path6.join)(parityAgentsDir, `${agentName}.md`));
    }
    for (const targetPath of targets) {
      if (!(0, import_node_fs8.existsSync)(targetPath)) {
        continue;
      }
      const raw = (0, import_node_fs8.readFileSync)(targetPath, "utf8");
      const patched = patchAgentModelContent(raw, modelValue);
      if (patched === null) {
        console.warn(
          `applyAgentModels: skipping ${targetPath} \u2014 missing or unterminated YAML frontmatter`
        );
        continue;
      }
      if (patched === raw) {
        continue;
      }
      await atomicWriteFile(targetPath, patched);
      changedFiles.push(targetPath);
    }
  }
  return changedFiles;
}
function patchAgentModelContent(text, modelValue) {
  const open = text.match(/^---(\r?\n)/);
  if (!open) return null;
  const fmStart = open[0].length;
  const rest = text.slice(fmStart);
  const close = rest.match(/(^|\r?\n)---(\r?\n|$)/);
  if (!close) return null;
  const innerEnd = fmStart + close.index + close[1].length;
  const inner = text.slice(fmStart, innerEnd);
  let newInner;
  const modelRe = /^model:[^\r\n]*/m;
  if (modelRe.test(inner)) {
    newInner = inner.replace(modelRe, `model: ${modelValue}`);
  } else {
    const descMatch = inner.match(/^description:[^\r\n]*(\r?\n)/m);
    if (descMatch) {
      const insertAt = descMatch.index + descMatch[0].length;
      const eol = descMatch[1];
      newInner = inner.slice(0, insertAt) + `model: ${modelValue}${eol}` + inner.slice(insertAt);
    } else {
      newInner = inner + `model: ${modelValue}${open[1]}`;
    }
  }
  return text.slice(0, fmStart) + newInner + text.slice(innerEnd);
}
var DEVELOPER_NON_BASH_TOOLS = Object.freeze(["Read", "Write", "Edit", "Grep", "Glob", "mcp__github__*"]);
var CORE_DEVELOPER_BASH = Object.freeze(["Bash(git:*)", "Bash(npm:*)", "Bash(node:*)", "Bash(npx:*)"]);
var STACK_BASH_ADDITIONS = Object.freeze({
  node: ["Bash(vitest:*)"],
  vue: ["Bash(vitest:*)"],
  react: ["Bash(vitest:*)"],
  python: ["Bash(python:*)", "Bash(pip:*)", "Bash(pytest:*)"],
  go: ["Bash(go:*)"],
  rust: ["Bash(cargo:*)"],
  ruby: ["Bash(ruby:*)", "Bash(bundle:*)", "Bash(rspec:*)"],
  java: ["Bash(mvn:*)", "Bash(gradle:*)"]
});
function normalizeDevStack(devStack) {
  if (devStack === void 0 || devStack === null) return [];
  const arr = Array.isArray(devStack) ? devStack : String(devStack).split(",").map((s) => s.trim()).filter(Boolean);
  for (const token of arr) {
    if (!Object.prototype.hasOwnProperty.call(STACK_BASH_ADDITIONS, token)) {
      throw new Error(
        `generateDeveloperToolsLine: invalid/unknown dev_stack value "${token}". Known stack values: ${Object.keys(STACK_BASH_ADDITIONS).join(", ")}`
      );
    }
  }
  return arr;
}
function generateDeveloperToolsLine({ devStack } = {}) {
  const normalized = normalizeDevStack(devStack);
  const bashPatterns = [...CORE_DEVELOPER_BASH];
  for (const token of normalized) {
    for (const pattern of STACK_BASH_ADDITIONS[token]) {
      if (!bashPatterns.includes(pattern)) bashPatterns.push(pattern);
    }
  }
  return [...DEVELOPER_NON_BASH_TOOLS, ...bashPatterns].join(", ");
}
async function applyDeveloperPermissions({ repoRoot, devStack } = {}) {
  const toolsLine = generateDeveloperToolsLine({ devStack });
  const claudeAgentsDir = (0, import_node_path6.join)(repoRoot, ".claude", "agents");
  const parityAgentsDir = (0, import_node_path6.join)(repoRoot, "agents");
  const hasParityDir = (0, import_node_fs8.existsSync)(parityAgentsDir);
  const targets = [(0, import_node_path6.join)(claudeAgentsDir, "developer.md")];
  if (hasParityDir) targets.push((0, import_node_path6.join)(parityAgentsDir, "developer.md"));
  const changedFiles = [];
  for (const targetPath of targets) {
    if (!(0, import_node_fs8.existsSync)(targetPath)) continue;
    const raw = (0, import_node_fs8.readFileSync)(targetPath, "utf8");
    const patched = patchAgentToolsContent(raw, toolsLine);
    if (patched === null) {
      console.warn(
        `applyDeveloperPermissions: skipping ${targetPath} \u2014 missing or unterminated YAML frontmatter`
      );
      continue;
    }
    if (patched === raw) continue;
    await atomicWriteFile(targetPath, patched);
    changedFiles.push(targetPath);
  }
  return changedFiles;
}
function patchAgentToolsContent(text, toolsLine) {
  const open = text.match(/^---(\r?\n)/);
  if (!open) return null;
  const fmStart = open[0].length;
  const rest = text.slice(fmStart);
  const close = rest.match(/(^|\r?\n)---(\r?\n|$)/);
  if (!close) return null;
  const innerEnd = fmStart + close.index + close[1].length;
  const inner = text.slice(fmStart, innerEnd);
  let newInner;
  const toolsRe = /^tools:[^\r\n]*/m;
  if (toolsRe.test(inner)) {
    newInner = inner.replace(toolsRe, `tools: ${toolsLine}`);
  } else {
    const modelMatch = inner.match(/^model:[^\r\n]*(\r?\n)/m);
    const descMatch = inner.match(/^description:[^\r\n]*(\r?\n)/m);
    if (modelMatch) {
      const insertAt = modelMatch.index + modelMatch[0].length;
      const eol = modelMatch[1];
      newInner = inner.slice(0, insertAt) + `tools: ${toolsLine}${eol}` + inner.slice(insertAt);
    } else if (descMatch) {
      const insertAt = descMatch.index + descMatch[0].length;
      const eol = descMatch[1];
      newInner = inner.slice(0, insertAt) + `tools: ${toolsLine}${eol}` + inner.slice(insertAt);
    } else {
      newInner = inner + `tools: ${toolsLine}${open[1]}`;
    }
  }
  return text.slice(0, fmStart) + newInner + text.slice(innerEnd);
}

// src/backlog-seeder.js
var import_node_fs10 = require("node:fs");
var import_node_path8 = require("node:path");

// src/task-store.js
var import_promises2 = require("node:fs/promises");
var import_node_fs9 = require("node:fs");
var import_node_path7 = require("node:path");
var import__3 = __toESM(require__(), 1);
var import_ajv_formats3 = __toESM(require_dist(), 1);

// tasks/schema.json
var schema_default = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://hivemind.local/tasks/schema.json",
  title: "Task",
  description: "A single unit of work for the agentic team. Field names mirror Jira issue fields so the same task can later be created in Jira without lossy translation.",
  type: "object",
  required: ["key", "title", "description", "acceptance_criteria", "status", "priority", "created_at", "updated_at"],
  additionalProperties: false,
  properties: {
    key: {
      type: "string",
      pattern: "^TASK-[0-9]{3,}$",
      description: "Stable human-readable identifier. Maps to Jira issue key on migration."
    },
    title: {
      type: "string",
      minLength: 1,
      maxLength: 200,
      description: "One-line summary. Maps to Jira `summary`."
    },
    description: {
      type: "string",
      description: "Markdown-formatted full description of the work. Maps to Jira `description`."
    },
    acceptance_criteria: {
      type: "array",
      minItems: 1,
      items: { type: "string" },
      description: "Falsifiable criteria for 'done'. Criteria are verified according to the ticket's verification_tier: tests for tdd, regression locks for tests-after, recorded UAT for uat-only."
    },
    verification_tier: {
      type: "string",
      enum: ["tdd", "tests-after", "uat-only"],
      description: "Governs how the ticket is verified. Absent means tdd (backward-compatible default). tdd = tests-first; tests-after = implement then add minimal regression locks; uat-only = no new specs, verified via conversational UAT."
    },
    marker: {
      type: "string",
      enum: ["[EXPLICIT]", "[INFERRED:strong]", "[INFERRED:weak]", "[INFERRED]", "[ASSUMED]", "[MISSING_INFO]"],
      description: "Epistemic calibration of the ticket's load-bearing claims (Spine). Optional; ACs may also carry inline markers, which the reviewer validates. Must respect source_tier's ceiling (T3/T4 cannot be [EXPLICIT])."
    },
    source_tier: {
      type: "string",
      enum: ["T1", "T2", "T3", "T4", "TX"],
      description: "Authority of the evidence behind the ticket's claims. Caps how strong marker may be: [EXPLICIT] requires T1/T2; T4 is orientation-only; TX is rejected. See .knowledge/meta/SOURCE_TIERS.md."
    },
    confidence: {
      type: "object",
      additionalProperties: false,
      description: "Decomposed confidence (components, NOT a scalar), populated from the brain's confidence model. Each component is in [0,1].",
      properties: {
        source_credibility: { type: "number", minimum: 0, maximum: 1 },
        assertion_strength: { type: "number", minimum: 0, maximum: 1 },
        corroboration: { type: "number", minimum: 0, maximum: 1 },
        verification_status: { type: "number", minimum: 0, maximum: 1 }
      }
    },
    status: {
      type: "string",
      enum: ["todo", "in_progress", "in_review", "blocked", "done"],
      description: "Lifecycle state. Maps to Jira workflow status."
    },
    priority: {
      type: "string",
      enum: ["low", "medium", "high", "critical"]
    },
    labels: {
      type: "array",
      items: { type: "string" },
      default: []
    },
    assignee: {
      type: ["string", "null"],
      description: "Subagent name or human identifier. Null = unassigned.",
      default: null
    },
    depends_on: {
      type: "array",
      items: { type: "string", pattern: "^TASK-[0-9]{3,}$" },
      default: [],
      description: "Other task keys that must reach `done` before this one can start."
    },
    linked_commits: {
      type: "array",
      items: { type: "string" },
      default: []
    },
    linked_prs: {
      type: "array",
      items: { type: "string" },
      default: []
    },
    comments: {
      type: "array",
      default: [],
      items: {
        type: "object",
        required: ["author", "at", "body"],
        additionalProperties: false,
        properties: {
          author: { type: "string" },
          at: { type: "string", format: "date-time" },
          body: { type: "string" }
        }
      }
    },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
    jira_key: {
      type: ["string", "null"],
      default: null,
      description: "Populated when the task has been mirrored to Jira. Until then, null."
    }
  }
};

// src/task-store.js
var PRIORITIES = ["low", "medium", "high", "critical"];
var TASK_FILENAME_RE = /^TASK-(\d{3,})\.json$/;
var __ajv2 = new import__3.default({ allErrors: true, strict: false });
(0, import_ajv_formats3.default)(__ajv2);
var __validateTask = __ajv2.compile(schema_default);
function validateTaskOrThrow(task) {
  const ok = __validateTask(task);
  if (ok) return;
  const errs = __validateTask.errors || [];
  const msg = errs.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
  throw new Error(`task payload failed schema validation: ${msg}`);
}
function tasksDir(repoRoot) {
  return (0, import_node_path7.join)(repoRoot, "tasks");
}
function taskFilePath(repoRoot, key) {
  return (0, import_node_path7.join)(tasksDir(repoRoot), `${key}.json`);
}
function indexFilePath(repoRoot) {
  return (0, import_node_path7.join)(tasksDir(repoRoot), "index.json");
}
function numericKeyOrder(a, b) {
  const ka = typeof a === "string" ? a : a.key;
  const kb = typeof b === "string" ? b : b.key;
  const ma = /-(\d+)$/.exec(ka);
  const mb = /-(\d+)$/.exec(kb);
  if (ma && mb) {
    const na = parseInt(ma[1], 10);
    const nb = parseInt(mb[1], 10);
    if (na !== nb) return na - nb;
    return 0;
  }
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}
async function readAllTasks(repoRoot) {
  const dir = tasksDir(repoRoot);
  let entries;
  try {
    entries = await (0, import_promises2.readdir)(dir);
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
  const taskFiles = entries.filter((name) => TASK_FILENAME_RE.test(name));
  const out = [];
  for (const name of taskFiles) {
    const raw = await (0, import_promises2.readFile)((0, import_node_path7.join)(dir, name), "utf8");
    if (raw.length === 0) continue;
    out.push(JSON.parse(raw));
  }
  return out;
}
function buildIndexBytes(tasks, generatedAt) {
  const summary = tasks.map((t) => ({
    key: t.key,
    title: t.title,
    status: t.status,
    priority: t.priority
  })).sort(numericKeyOrder);
  return JSON.stringify({ generated_at: generatedAt, tasks: summary }, null, 2) + "\n";
}
var KeyCollisionError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "KeyCollisionError";
    this.code = "E_KEY_COLLISION";
  }
};
async function appendComment({
  repoRoot,
  key,
  author,
  body,
  now = () => (/* @__PURE__ */ new Date()).toISOString()
}) {
  const allTasks = await readAllTasks(repoRoot);
  const task = allTasks.find((t) => t.key === key);
  if (!task) throw new Error(`unknown task key: ${key}`);
  const stamp = now();
  const comment = { author, at: stamp, body };
  task.comments = Array.isArray(task.comments) ? [...task.comments, comment] : [comment];
  task.updated_at = stamp;
  validateTaskOrThrow(task);
  await atomicWriteFiles([
    { target: taskFilePath(repoRoot, key), bytes: JSON.stringify(task, null, 2) + "\n" },
    { target: indexFilePath(repoRoot), bytes: buildIndexBytes(allTasks, stamp) }
  ]);
}
async function deriveNextKey(repoRoot) {
  const dir = tasksDir(repoRoot);
  let entries;
  try {
    entries = await (0, import_promises2.readdir)(dir);
  } catch (err) {
    if (err && err.code === "ENOENT") entries = [];
    else throw err;
  }
  let maxN = 0;
  for (const name of entries) {
    const m = TASK_FILENAME_RE.exec(name);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n > maxN) maxN = n;
  }
  const next = maxN + 1;
  const width = Math.max(3, String(next).length);
  return `TASK-${String(next).padStart(width, "0")}`;
}
var VERIFICATION_TIERS = ["tdd", "tests-after", "uat-only"];
async function createTask({
  repoRoot,
  title,
  description,
  acceptance_criteria,
  priority,
  labels = [],
  depends_on = [],
  verification_tier,
  marker,
  source_tier,
  confidence,
  now = () => (/* @__PURE__ */ new Date()).toISOString()
}) {
  if (!Array.isArray(acceptance_criteria) || acceptance_criteria.length === 0) {
    throw new Error(
      "acceptance_criteria must be a non-empty array (schema minItems: 1)"
    );
  }
  if (!PRIORITIES.includes(priority)) {
    throw new Error(
      `invalid priority "${priority}" \u2014 must be one of ${PRIORITIES.join(", ")}`
    );
  }
  if (verification_tier !== void 0 && !VERIFICATION_TIERS.includes(verification_tier)) {
    throw new Error(
      `invalid verification_tier "${verification_tier}" \u2014 must be one of ${VERIFICATION_TIERS.join(", ")}`
    );
  }
  const key = await deriveNextKey(repoRoot);
  const stamp = now();
  const task = {
    key,
    title,
    description,
    acceptance_criteria,
    status: "todo",
    priority,
    labels,
    assignee: null,
    depends_on,
    linked_commits: [],
    linked_prs: [],
    comments: [],
    created_at: stamp,
    updated_at: stamp,
    jira_key: null,
    ...verification_tier !== void 0 ? { verification_tier } : {},
    // Spine calibration (Phase 2) — optional; schema-validated below. Enums/ceilings are enforced
    // by validateTaskOrThrow before any disk I/O, and the reviewer runs the calibration validators.
    ...marker !== void 0 ? { marker } : {},
    ...source_tier !== void 0 ? { source_tier } : {},
    ...confidence !== void 0 ? { confidence } : {}
  };
  validateTaskOrThrow(task);
  const existing = await readAllTasks(repoRoot);
  const allTasks = [...existing, task];
  (0, import_node_fs9.mkdirSync)(tasksDir(repoRoot), { recursive: true });
  const target = taskFilePath(repoRoot, key);
  const taskBytes = JSON.stringify(task, null, 2) + "\n";
  const payload = Buffer.from(taskBytes, "utf8");
  let reserveFd;
  try {
    reserveFd = (0, import_node_fs9.openSync)(target, import_node_fs9.constants.O_CREAT | import_node_fs9.constants.O_EXCL | import_node_fs9.constants.O_WRONLY, 384);
  } catch (err) {
    if (err && err.code === "EEXIST") {
      throw new KeyCollisionError(
        `createTask: key collision \u2014 ${target} already exists (a concurrent writer won the race for ${key})`
      );
    }
    throw err;
  }
  try {
    let written = 0;
    while (written < payload.length) {
      written += (0, import_node_fs9.writeSync)(reserveFd, payload, written, payload.length - written);
    }
    (0, import_node_fs9.fsyncSync)(reserveFd);
  } finally {
    (0, import_node_fs9.closeSync)(reserveFd);
  }
  const onDisk = (0, import_node_fs9.readFileSync)(target, "utf8");
  if (onDisk !== taskBytes) {
    throw new KeyCollisionError(
      `createTask: verify-after-write detected a competing writer's payload at ${target} (derived-key collision) \u2014 our write was overwritten immediately after landing.`
    );
  }
  await atomicWriteFiles([
    { target: indexFilePath(repoRoot), bytes: buildIndexBytes(allTasks, stamp) }
  ]);
  return { key, path: target };
}

// src/backlog-seeder.js
var COMMON_TEMPLATES = Object.freeze([
  Object.freeze({
    title: "Set up project CI",
    description: "Wire up a basic continuous-integration pipeline that runs the test suite and the linter on every push and pull request. This is the first piece of automation every fresh project needs.",
    acceptance_criteria: Object.freeze([
      "CI pipeline runs the full test suite on every push to the default branch.",
      "CI pipeline runs the linter and fails the build on any lint error.",
      "CI status is visible from the repository host (badge or required check)."
    ]),
    priority: "high",
    labels: Object.freeze(["ci"])
  })
]);
var USE_CASE_TEMPLATES = Object.freeze({
  "data-entry": Object.freeze([
    Object.freeze({
      title: "Define data input schema",
      description: "Document the structure and constraints of every input form / API payload the application accepts. Drives validation layer design.",
      acceptance_criteria: Object.freeze([
        "Each input surface has a named schema (e.g. JSON Schema or equivalent).",
        "Required vs optional fields are explicit for every field."
      ]),
      priority: "high",
      labels: Object.freeze(["schema"])
    }),
    Object.freeze({
      title: "Add input validation layer",
      description: "Implement a centralized validation step so every user-supplied payload is rejected with a clear error before reaching business logic.",
      acceptance_criteria: Object.freeze([
        "Invalid payloads return a structured 4xx error naming the failed field.",
        "Validation runs before any database write."
      ]),
      priority: "medium",
      labels: Object.freeze(["validation"])
    })
  ]),
  "reporting": Object.freeze([
    Object.freeze({
      title: "Define report data sources",
      description: "Inventory the tables, APIs, and event streams that feed reports. Without this catalog, report endpoints accumulate ad-hoc joins.",
      acceptance_criteria: Object.freeze([
        "Each report has a documented data source list.",
        "Source freshness expectations (real-time vs daily) are recorded."
      ]),
      priority: "high",
      labels: Object.freeze(["data-model"])
    }),
    Object.freeze({
      title: "Build first report endpoint",
      description: "Ship one end-to-end report so the rest of the reporting stack has a working reference implementation to follow.",
      acceptance_criteria: Object.freeze([
        "Endpoint returns a documented JSON or CSV payload.",
        "Endpoint is covered by at least one integration test."
      ]),
      priority: "medium",
      labels: Object.freeze(["endpoint"])
    })
  ]),
  "integration": Object.freeze([
    Object.freeze({
      title: "Document upstream APIs",
      description: "For every external system this project talks to, capture base URL, auth, rate limits, and failure modes in one place.",
      acceptance_criteria: Object.freeze([
        "Each upstream has a documented base URL and auth scheme.",
        "Known rate limits and retry policies are recorded."
      ]),
      priority: "high",
      labels: Object.freeze(["docs"])
    }),
    Object.freeze({
      title: "Add integration test harness",
      description: "Set up a harness that exercises real (or recorded) upstream calls so contract drift surfaces in CI rather than in production.",
      acceptance_criteria: Object.freeze([
        "At least one integration test exists and runs in CI.",
        "Harness supports either live calls or recorded fixtures behind a flag."
      ]),
      priority: "medium",
      labels: Object.freeze(["testing"])
    })
  ]),
  "automation": Object.freeze([
    Object.freeze({
      title: "Identify trigger source",
      description: "Pin down what fires the automation: cron, webhook, queue message, or manual. Trigger choice constrains the whole runtime shape.",
      acceptance_criteria: Object.freeze([
        "Trigger mechanism is documented (cron expression, event topic, etc.).",
        "Expected invocation frequency is recorded."
      ]),
      priority: "high",
      labels: Object.freeze(["design"])
    }),
    Object.freeze({
      title: "Add idempotency guard",
      description: "Automations re-run. Add the de-duplication mechanism (job id, natural key, etc.) so duplicate firings are no-ops.",
      acceptance_criteria: Object.freeze([
        "Re-running the automation with the same input produces no side effects.",
        "Idempotency key strategy is documented."
      ]),
      priority: "medium",
      labels: Object.freeze(["reliability"])
    })
  ]),
  "collaboration": Object.freeze([
    Object.freeze({
      title: "Define user roles and permissions",
      description: "Enumerate the roles (admin, editor, viewer, etc.) and the actions each one may take. Drives the authorization layer.",
      acceptance_criteria: Object.freeze([
        "Role list is documented with at least one capability per role.",
        "A permission matrix maps roles to allowed actions."
      ]),
      priority: "high",
      labels: Object.freeze(["authz"])
    }),
    Object.freeze({
      title: "Add audit log",
      description: "Persist a tamper-resistant log of who did what when. Required for any multi-user product handling non-trivial data.",
      acceptance_criteria: Object.freeze([
        "Every state-changing action writes an audit entry with actor + timestamp.",
        "Audit log is queryable by actor and by target resource."
      ]),
      priority: "medium",
      labels: Object.freeze(["audit"])
    })
  ]),
  "other": Object.freeze([
    Object.freeze({
      title: "Define initial milestone",
      description: "The project type is open-ended. Pick the first measurable milestone and write down what shipping it means.",
      acceptance_criteria: Object.freeze([
        "Milestone has a one-sentence definition of done.",
        "Milestone has at least one verifiable success criterion."
      ]),
      priority: "high",
      labels: Object.freeze(["planning"])
    })
  ])
});
function readAllTasksSync(repoRoot) {
  const dir = (0, import_node_path8.join)(repoRoot, "tasks");
  if (!(0, import_node_fs10.existsSync)(dir)) return [];
  const names = (0, import_node_fs10.readdirSync)(dir).filter((n) => TASK_FILENAME_RE.test(n));
  const out = [];
  for (const name of names) {
    const filePath = (0, import_node_path8.join)(dir, name);
    let raw;
    try {
      raw = (0, import_node_fs10.readFileSync)(filePath, "utf8");
    } catch (err) {
      if (err && err.code === "ENOENT") continue;
      throw err;
    }
    try {
      out.push(JSON.parse(raw));
    } catch (err) {
      throw new Error(
        `backlog-seeder: failed to parse task file ${name}: ${err.message}`
      );
    }
  }
  return out;
}
function normalizeUseCases(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((v) => typeof v === "string" && v.length > 0);
  }
  if (typeof raw === "string" && raw.length > 0) {
    if (raw.includes(",")) {
      return raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    }
    return [raw];
  }
  return [];
}
async function mintTicket({ repoRoot, template, tag, now }) {
  const labels = Array.from(
    /* @__PURE__ */ new Set(["seed", ...Array.isArray(template.labels) ? template.labels : []])
  );
  const { key } = await createTask({
    repoRoot,
    title: template.title,
    description: template.description,
    acceptance_criteria: [...template.acceptance_criteria],
    priority: template.priority,
    labels,
    now
  });
  const body = tag === "common" ? "common starter ticket \u2014 applies to every fresh project" : `Triggered by primary_use_case: ${tag}`;
  await appendComment({
    repoRoot,
    key,
    author: "backlog-seeder",
    body,
    now
  });
  return key;
}
async function seedBacklog({
  repoRoot,
  answers,
  now = () => (/* @__PURE__ */ new Date()).toISOString()
}) {
  const existing = readAllTasksSync(repoRoot);
  for (const t of existing) {
    if (Array.isArray(t.labels) && t.labels.includes("seed")) {
      return { created: [] };
    }
  }
  const useCases = normalizeUseCases(answers && answers.primary_use_cases);
  const created = [];
  for (const tpl of COMMON_TEMPLATES) {
    const key = await mintTicket({ repoRoot, template: tpl, tag: "common", now });
    created.push(key);
  }
  for (const uc of new Set(useCases)) {
    const templates = USE_CASE_TEMPLATES[uc];
    if (!templates) continue;
    for (const tpl of templates) {
      const key = await mintTicket({ repoRoot, template: tpl, tag: uc, now });
      created.push(key);
    }
  }
  return { created };
}

// src/use-case-specs.js
var import_node_fs11 = require("node:fs");
var import_promises3 = require("node:fs/promises");
var import_node_path9 = require("node:path");
var STACK_ANSWER_KEYS = [
  "cli_language",
  "backend_framework",
  "library_language",
  "frontend_framework",
  "processing_framework"
];
var JS_LANGUAGE_RE = /^(node|javascript|typescript)/i;
var MAX_PRIMARY_USE_CASES = 50;
var JS_FRONTEND_FRAMEWORKS = /* @__PURE__ */ new Set(["react", "vue", "svelte", "angular"]);
function isJsStack(answers) {
  if (!answers || typeof answers !== "object") return false;
  for (const key of STACK_ANSWER_KEYS) {
    const val = answers[key];
    if (typeof val !== "string" || val.length === 0) continue;
    if (JS_LANGUAGE_RE.test(val.trim())) return true;
    if (val.toLowerCase().includes("node")) return true;
  }
  const fe = answers.frontend_framework;
  if (typeof fe === "string" && JS_FRONTEND_FRAMEWORKS.has(fe.trim().toLowerCase())) {
    return true;
  }
  return false;
}
function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function normalizeUseCases2(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((v) => typeof v === "string" && v.length > 0);
  }
  if (typeof raw === "string" && raw.length > 0) {
    if (raw.includes(",")) {
      return raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    }
    return [raw];
  }
  return [];
}
function buildManifest({ projectName, useCases, generatedAt, isJs }) {
  const lines = [
    "# Use-Case Suite",
    "",
    `**Project:** ${projectName}`,
    `**Generated:** ${generatedAt}`,
    "",
    "## Primary Use Cases",
    "",
    "This manifest designates the primary use cases for this project.",
    "Each use case is covered by one or more spec files listed below.",
    "Tickets must only modify this suite when a primary use case changes",
    "(new, changed, or removed use case) \u2014 never one spec per ticket.",
    ""
  ];
  if (useCases.length === 0) {
    lines.push("_No primary use cases specified._", "");
  } else {
    for (const uc of useCases) {
      const slug = slugify(uc);
      lines.push(`### ${uc}`, "");
      if (isJs) {
        lines.push(`- tests/use-cases/${slug}.spec.js`, "");
      } else {
        lines.push(
          "_No JS-ecosystem stack detected: no skeleton spec files generated._",
          "_Add your own test runner entries here._",
          ""
        );
      }
    }
  }
  return lines.join("\n");
}
function buildSkeletonSpec(useCase) {
  const nameLit = JSON.stringify(useCase);
  const happyLit = JSON.stringify(`${useCase}: end-to-end happy path`);
  const edgeLit = JSON.stringify(`${useCase}: error / edge cases`);
  return [
    `// tests/use-cases/${slugify(useCase)}.spec.js`,
    `// Use-case regression skeleton for: ${nameLit}`,
    "// Generated by generateUseCaseSuite (src/use-case-specs.js).",
    "// Modify ONLY when the primary use case definition changes.",
    "",
    "import { describe, it } from 'vitest';",
    "",
    `describe(${nameLit}, () => {`,
    `  it.todo(${happyLit});`,
    `  it.todo(${edgeLit});`,
    "});",
    ""
  ].join("\n");
}
async function generateUseCaseSuite({
  repoRoot,
  answers,
  now = () => (/* @__PURE__ */ new Date()).toISOString()
}) {
  const useCasesDir = (0, import_node_path9.join)(repoRoot, "tests", "use-cases");
  await (0, import_promises3.mkdir)(useCasesDir, { recursive: true });
  const normalizedUseCases = normalizeUseCases2(answers && answers.primary_use_cases);
  let useCases = normalizedUseCases;
  if (normalizedUseCases.length > MAX_PRIMARY_USE_CASES) {
    const droppedCount = normalizedUseCases.length - MAX_PRIMARY_USE_CASES;
    console.warn(
      `generateUseCaseSuite: primary_use_cases had ${normalizedUseCases.length} entries, which exceeds the MAX_PRIMARY_USE_CASES cap of ${MAX_PRIMARY_USE_CASES}. Keeping the first ${MAX_PRIMARY_USE_CASES} and dropping ${droppedCount} entries. Trim your primary_use_cases answer to the project's real product-surface use cases and re-run if this was unintentional.`
    );
    useCases = normalizedUseCases.slice(0, MAX_PRIMARY_USE_CASES);
  }
  const projectName = (answers && typeof answers.project_name === "string" ? answers.project_name : null) || "unnamed-project";
  const js = isJsStack(answers);
  const generatedAt = now();
  const manifestPath = (0, import_node_path9.join)(useCasesDir, "USE-CASES.md");
  if (!(0, import_node_fs11.existsSync)(manifestPath)) {
    const content = buildManifest({ projectName, useCases, generatedAt, isJs: js });
    await atomicWriteFile(manifestPath, content);
  }
  const specPaths = [];
  if (js) {
    const seen = /* @__PURE__ */ new Set();
    for (const uc of useCases) {
      const slug = slugify(uc);
      if (seen.has(slug)) continue;
      seen.add(slug);
      const specPath = (0, import_node_path9.join)(useCasesDir, `${slug}.spec.js`);
      if (!(0, import_node_fs11.existsSync)(specPath)) {
        const content = buildSkeletonSpec(uc);
        await atomicWriteFile(specPath, content);
      }
      specPaths.push(specPath);
    }
  }
  return { manifestPath, specPaths };
}

// src/framework-history.js
var import_node_fs12 = require("node:fs");
var import_node_path10 = require("node:path");
var TASK_FILE_RE = /^TASK-\d{3,}\.json$/;
async function archiveFrameworkHistory({
  repoRoot,
  now = () => (/* @__PURE__ */ new Date()).toISOString()
}) {
  const tasksDir2 = (0, import_node_path10.join)(repoRoot, "tasks");
  if (!(0, import_node_fs12.existsSync)(tasksDir2)) {
    return { archived: [] };
  }
  const taskFiles = (0, import_node_fs12.readdirSync)(tasksDir2).filter((n) => TASK_FILE_RE.test(n)).sort();
  if (taskFiles.length === 0) {
    return { archived: [] };
  }
  const parsed = [];
  for (const name of taskFiles) {
    const fullPath = (0, import_node_path10.join)(tasksDir2, name);
    let ticket;
    try {
      ticket = JSON.parse((0, import_node_fs12.readFileSync)(fullPath, "utf8"));
    } catch {
      ticket = { labels: [] };
    }
    if (Array.isArray(ticket.labels) && ticket.labels.includes("seed")) {
      return { archived: [] };
    }
    parsed.push({ name, fullPath, ticket });
  }
  const archiveDir = (0, import_node_path10.join)(repoRoot, ".framework-history", "tasks");
  (0, import_node_fs12.mkdirSync)(archiveDir, { recursive: true });
  const archived = [];
  for (const { name, fullPath, ticket } of parsed) {
    const dest = (0, import_node_path10.join)(archiveDir, name);
    (0, import_node_fs12.renameSync)(fullPath, dest);
    const key = typeof ticket.key === "string" && ticket.key.length > 0 ? ticket.key : name.replace(/\.json$/, "");
    archived.push(key);
  }
  archived.sort();
  const indexPath = (0, import_node_path10.join)(tasksDir2, "index.json");
  const payload = JSON.stringify(
    { generated_at: now(), tasks: [] },
    null,
    2
  ) + "\n";
  await atomicWriteFile(indexPath, payload);
  return { archived };
}

// src/repo-root.js
function resolveRepoRoot(env, cwd) {
  const fromEnv = env && env.CLAUDE_PROJECT_DIR;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") {
    return fromEnv;
  }
  return cwd;
}

// src/claude-md.js
var import_node_fs13 = require("node:fs");
var import_node_path11 = require("node:path");
var BEGIN_MARKER = "<!-- BEGIN hivemind routing -->";
var END_MARKER = "<!-- END hivemind routing -->";
function routingBlockContent() {
  return [
    "## Orchestrator activation (hivemind)",
    "",
    "This project is operated by a multi-agent team. The main thread is the",
    "**Orchestrator**: it plans and delegates to the `researcher`, `developer`, and",
    "`reviewer` subagents \u2014 it does not write production code itself.",
    "",
    "### RESUME-FIRST (do this before anything else in every new chat)",
    "",
    "Session state is split across two layers: a tiny **pointer file** at",
    "`state/session.json` (`schema_version`, `active_session_id`, `updated_at`) and a",
    "self-contained **bundle directory** at `state/sessions/<active_session_id>/`",
    "whose own `session.json` holds the substantive state (`workflow_step`,",
    "`handoff_summary`, `next_action`, `open_questions`, `blockers`, `decisions`,",
    "`subagent_results`). The very first action of every new chat is:",
    "",
    "1. Read `state/session.json` (the pointer). If it is absent or",
    "   `active_session_id` is null, the orchestrator is idle \u2014 confirm with the",
    "   human before starting a new session.",
    "2. If `active_session_id` is non-null, read",
    "   `state/sessions/<active_session_id>/session.json` for the handoff state.",
    "3. If that bundle's `active_task` is non-null, read `tasks/<active_task>.json`",
    "   to load the work item.",
    "4. Restate `handoff_summary` and `next_action` to the human in one short",
    "   paragraph and confirm before acting.",
    "",
    "### First-chat routing",
    "",
    "If `PROJECT.md` does not exist in the repo root, the framework has not been",
    "initialized for this project \u2014 run the `/init-project` command (the project",
    "intake wizard) before any other workflow step. If `PROJECT.md` already exists,",
    "proceed to RESUME-FIRST.",
    "",
    "### Workflow loop (every unit of work)",
    "",
    "1. Read the next `status: todo` ticket, extract acceptance criteria, and",
    "   assign its `verification_tier` (`tdd`, `tests-after`, or `uat-only`) if it",
    "   does not already carry one.",
    "2. Plan: decompose into research / verification / implementation / review.",
    "3. Research (if needed): spawn the `researcher` for any unknown stack.",
    "4. Verify per tier: `tdd` writes failing tests before any implementation",
    "   lands; `tests-after` implements first, then adds a minimal set of",
    "   regression locks; `uat-only` implements only and is verified by",
    "   conversational UAT with the human.",
    "5. Implement: the `developer` makes the tier's tests (if any) pass without",
    "   breaking existing ones.",
    "6. Review: spawn the `reviewer` in a fresh context; block on any HIGH finding.",
    "7. Update the ticket on a green review, then pause or end the session.",
    "",
    "To self-drive this loop across several tickets toward a stated goal instead",
    "of repeating these steps by hand, use `/hivemind:loop`.",
    "",
    "### Repository etiquette",
    "",
    "- Conventional Commits (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`,",
    "  `chore:`); one logical change per commit.",
    "- Never commit secrets; never `--no-verify`; never force-push a shared branch.",
    "- Human-in-the-loop for destructive or irreversible actions."
  ].join("\n");
}
function mergeRoutingBlock(existing, routing) {
  const block = `${BEGIN_MARKER}
${routing}
${END_MARKER}`;
  if (existing === null || existing === void 0 || existing === "") {
    return `${block}
`;
  }
  const begin = existing.indexOf(BEGIN_MARKER);
  const end = existing.indexOf(END_MARKER);
  if (begin !== -1 && end !== -1 && end > begin) {
    const prefix = existing.slice(0, begin);
    const suffix = existing.slice(end + END_MARKER.length);
    return `${prefix}${block}${suffix}`;
  }
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  return `${existing}${sep}${block}
`;
}
function writeOrchestratorRouting({ repoRoot }) {
  const path = (0, import_node_path11.join)(repoRoot, "CLAUDE.md");
  const existing = (0, import_node_fs13.existsSync)(path) ? (0, import_node_fs13.readFileSync)(path, "utf8") : null;
  const hadBlock = existing !== null && hasRoutingBlock(existing);
  const merged = mergeRoutingBlock(existing, routingBlockContent());
  if (existing !== null && merged === existing) {
    return { path, wrote: false, hadBlock };
  }
  (0, import_node_fs13.writeFileSync)(path, merged, "utf8");
  return { path, wrote: true, hadBlock };
}
function hasRoutingBlock(text) {
  if (typeof text !== "string") return false;
  const begin = text.indexOf(BEGIN_MARKER);
  const end = text.indexOf(END_MARKER);
  return begin !== -1 && end !== -1 && end > begin;
}
function readProjectClaudeMd(repoRoot) {
  const path = (0, import_node_path11.join)(repoRoot, "CLAUDE.md");
  return (0, import_node_fs13.existsSync)(path) ? (0, import_node_fs13.readFileSync)(path, "utf8") : null;
}

// src/claude-settings.js
var import_node_fs14 = require("node:fs");
var import_node_path12 = require("node:path");
var import_node_url = require("node:url");
var import_node_path13 = require("node:path");
var import_meta = {};
function resolvePluginRoot() {
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    return process.env.CLAUDE_PLUGIN_ROOT;
  }
  const here = import_meta.url ? (0, import_node_path13.dirname)((0, import_node_url.fileURLToPath)(import_meta.url)) : typeof __dirname !== "undefined" ? __dirname : process.cwd();
  return (0, import_node_path12.resolve)(here, "..");
}
function buildContextMonitorEntries(pluginRoot) {
  const cmDir = (0, import_node_path12.join)(pluginRoot, "context-monitor");
  const statusLineCmd = `node "${(0, import_node_path12.join)(cmDir, "statusline.mjs")}"`;
  const stopHookCmd = `node "${(0, import_node_path12.join)(cmDir, "stop-hook.mjs")}"`;
  const sessionStartCmd = `node "${(0, import_node_path12.join)(cmDir, "session-start.mjs")}"`;
  return {
    statusLine: {
      type: "command",
      command: statusLineCmd
    },
    stopHook: {
      type: "command",
      command: stopHookCmd
    },
    sessionStartHook: {
      type: "command",
      matcher: "clear|compact",
      command: sessionStartCmd
    }
  };
}
function mergeContextMonitorSettings(existing, entries) {
  const out = { ...existing };
  if (!out.statusLine) {
    out.statusLine = entries.statusLine;
  }
  if (!out.hooks || typeof out.hooks !== "object") {
    out.hooks = {};
  } else {
    out.hooks = { ...out.hooks };
  }
  if (!Array.isArray(out.hooks.Stop)) {
    out.hooks.Stop = [];
  } else {
    out.hooks.Stop = [...out.hooks.Stop];
  }
  const hasStopHook = out.hooks.Stop.some(
    (h) => h && typeof h.command === "string" && h.command.includes("stop-hook.mjs")
  );
  if (!hasStopHook) {
    out.hooks.Stop.push(entries.stopHook);
  }
  if (!Array.isArray(out.hooks.SessionStart)) {
    out.hooks.SessionStart = [];
  } else {
    out.hooks.SessionStart = [...out.hooks.SessionStart];
  }
  const hasSessionStartHook = out.hooks.SessionStart.some(
    (h) => h && typeof h.command === "string" && h.command.includes("session-start.mjs")
  );
  if (!hasSessionStartHook) {
    out.hooks.SessionStart.push(entries.sessionStartHook);
  }
  return out;
}
function writeClaudeSettings({ repoRoot, pluginRoot }) {
  const effectivePluginRoot = pluginRoot ?? resolvePluginRoot();
  const entries = buildContextMonitorEntries(effectivePluginRoot);
  const claudeDir = (0, import_node_path12.join)(repoRoot, ".claude");
  const settingsPath = (0, import_node_path12.join)(claudeDir, "settings.json");
  let existing = {};
  if ((0, import_node_fs14.existsSync)(settingsPath)) {
    try {
      existing = JSON.parse((0, import_node_fs14.readFileSync)(settingsPath, "utf8"));
      if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
        existing = {};
      }
    } catch {
      existing = {};
    }
  }
  const merged = mergeContextMonitorSettings(existing, entries);
  const serialized = JSON.stringify(merged, null, 2) + "\n";
  if ((0, import_node_fs14.existsSync)(settingsPath)) {
    const currentRaw = (0, import_node_fs14.readFileSync)(settingsPath, "utf8");
    if (currentRaw === serialized) {
      return { path: settingsPath, wrote: false };
    }
  }
  (0, import_node_fs14.mkdirSync)(claudeDir, { recursive: true });
  (0, import_node_fs14.writeFileSync)(settingsPath, serialized, "utf8");
  return { path: settingsPath, wrote: true };
}

// bin/init.js
var import_meta2 = {};
var __initDir = import_meta2.url ? (0, import_node_path14.dirname)((0, import_node_url2.fileURLToPath)(import_meta2.url)) : typeof __dirname !== "undefined" ? __dirname : process.cwd();
var PLUGIN_WORKFLOWS_SRC = (0, import_node_path14.join)(__initDir, "..", "workflows");
function materializeWorkflows(repoRoot) {
  const srcDir = PLUGIN_WORKFLOWS_SRC;
  if (!(0, import_node_fs15.existsSync)(srcDir)) return { added: [], skipped: [] };
  const destDir = (0, import_node_path14.join)(repoRoot, ".claude", "workflows");
  (0, import_node_fs15.mkdirSync)(destDir, { recursive: true });
  const added = [];
  const skipped = [];
  const entries = (0, import_node_fs15.readdirSync)(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const srcPath = (0, import_node_path14.join)(srcDir, entry.name);
    const destPath = (0, import_node_path14.join)(destDir, entry.name);
    if (!(0, import_node_fs15.existsSync)(destPath)) {
      (0, import_node_fs15.copyFileSync)(srcPath, destPath);
      added.push(entry.name);
    } else {
      skipped.push(entry.name);
    }
  }
  return { added, skipped };
}
var KNOWN_FLAGS = /* @__PURE__ */ new Set([
  "--force",
  "--help",
  "--no-archive",
  "--answers-file",
  "--claude-md-consent",
  "--apply-models",
  "--apply-workflows",
  "--apply-settings",
  "--apply-permissions",
  "--yes"
]);
var VALUE_FLAGS = /* @__PURE__ */ new Set(["--answers-file"]);
var TASK_FILE_RE2 = /^TASK-\d{3,}\.json$/;
function parseArgs(argv) {
  const out = {
    force: false,
    help: false,
    noArchive: false,
    answersFile: null,
    claudeMdConsent: false,
    applyModels: false,
    applyWorkflows: false,
    applySettings: false,
    applyPermissions: false,
    yes: false
  };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!KNOWN_FLAGS.has(tok)) {
      throw new Error(`unknown argument: ${tok}`);
    }
    if (tok === "--force") out.force = true;
    if (tok === "--help") out.help = true;
    if (tok === "--no-archive") out.noArchive = true;
    if (tok === "--claude-md-consent") out.claudeMdConsent = true;
    if (tok === "--apply-models") out.applyModels = true;
    if (tok === "--apply-workflows") out.applyWorkflows = true;
    if (tok === "--apply-settings") out.applySettings = true;
    if (tok === "--apply-permissions") out.applyPermissions = true;
    if (tok === "--yes") out.yes = true;
    if (tok === "--answers-file") {
      const value = argv[i + 1];
      if (value === void 0 || VALUE_FLAGS.has(value) || KNOWN_FLAGS.has(value)) {
        throw new Error("--answers-file requires a file path argument");
      }
      out.answersFile = value;
      i += 1;
    }
  }
  if (out.applyModels && (out.force || out.answersFile !== null)) {
    throw new Error("--apply-models cannot be combined with --force or --answers-file");
  }
  if (out.applyWorkflows && (out.force || out.answersFile !== null)) {
    throw new Error("--apply-workflows cannot be combined with --force or --answers-file");
  }
  if (out.applySettings && (out.force || out.answersFile !== null)) {
    throw new Error("--apply-settings cannot be combined with --force or --answers-file");
  }
  if (out.applyPermissions && (out.force || out.answersFile !== null)) {
    throw new Error("--apply-permissions cannot be combined with --force or --answers-file");
  }
  return out;
}
function countFrameworkHistory(repoRoot) {
  const tasksDir2 = (0, import_node_path14.join)(repoRoot, "tasks");
  if (!(0, import_node_fs15.existsSync)(tasksDir2)) return 0;
  const taskFiles = (0, import_node_fs15.readdirSync)(tasksDir2).filter((n) => TASK_FILE_RE2.test(n));
  if (taskFiles.length === 0) return 0;
  for (const name of taskFiles) {
    let t;
    try {
      t = JSON.parse((0, import_node_fs15.readFileSync)((0, import_node_path14.join)(tasksDir2, name), "utf8"));
    } catch (err) {
      throw new Error(
        `bin/init.js: failed to parse task file ${name}: ${err.message}`
      );
    }
    if (Array.isArray(t.labels) && t.labels.includes("seed")) {
      return 0;
    }
  }
  return taskFiles.length;
}
async function maybeArchiveFrameworkHistory({ repoRoot, prompter, noArchive, now }) {
  if (noArchive) return;
  const count = countFrameworkHistory(repoRoot);
  if (count === 0) return;
  const answer = await prompter({
    prompt: `Detected ${count} pre-existing tickets that look like framework history. Archive them so this project starts fresh? [Y/n]`,
    type: "string"
  });
  const trimmed = typeof answer === "string" ? answer.trim() : "";
  const consent = trimmed === "" || /^y/i.test(trimmed);
  if (!consent) return;
  await archiveFrameworkHistory({ repoRoot, now });
}
function intakePath(repoRoot, sessionId) {
  return (0, import_node_path14.join)(repoRoot, "state", "sessions", sessionId, "intake.json");
}
function tryReadIntake(path) {
  if (!(0, import_node_fs15.existsSync)(path)) return null;
  try {
    const raw = JSON.parse((0, import_node_fs15.readFileSync)(path, "utf8"));
    if (raw && typeof raw === "object" && raw.answers && typeof raw.answers === "object") {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}
var REQUIRED_ANSWER_KEYS = ["project_name", "project_type"];
function validateSuppliedAnswers(answers) {
  if (!answers || typeof answers !== "object") {
    throw new Error("init: supplied answers must be a non-empty object");
  }
  const missing = REQUIRED_ANSWER_KEYS.filter((k) => {
    const v = answers[k];
    return v === void 0 || v === null || v === "";
  });
  if (missing.length > 0) {
    throw new Error(
      `init: supplied answers are missing required key(s): ${missing.join(", ")}`
    );
  }
}
var DEFINITION_LIST_IDS = ["goals", "scope_in", "scope_out"];
function normalizeDefinitionAnswers(answers) {
  if (!answers || typeof answers !== "object") return answers;
  const needsNorm = DEFINITION_LIST_IDS.some(
    (id) => Object.prototype.hasOwnProperty.call(answers, id) && answers[id] !== null && answers[id] !== void 0
  );
  if (!needsNorm) return answers;
  const out = { ...answers };
  for (const id of DEFINITION_LIST_IDS) {
    if (!Object.prototype.hasOwnProperty.call(out, id)) continue;
    const v = out[id];
    if (v === null || v === void 0) continue;
    if (Array.isArray(v)) {
      out[id] = v.map((s) => typeof s === "string" ? s.trim() : String(s)).filter(Boolean);
    } else {
      const str = typeof v === "string" ? v : String(v);
      out[id] = str.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return out;
}
function buildDefinitionSummary(answers) {
  const lines = [];
  const add = (label, value) => {
    if (value === null || value === void 0) return;
    if (Array.isArray(value)) {
      if (value.length === 0) return;
      lines.push(`  ${label}: ${value.join(", ")}`);
    } else {
      const s = String(value).trim();
      if (s.length === 0) return;
      lines.push(`  ${label}: ${s}`);
    }
  };
  add("Problem", answers.problem_statement);
  add("Goals", answers.goals);
  add("Scope in", answers.scope_in);
  add("Scope out", answers.scope_out);
  add("Project", answers.project_name);
  add("Type", answers.project_type);
  const KNOWN_SUMMARY_IDS = /* @__PURE__ */ new Set([
    "problem_statement",
    "goals",
    "scope_in",
    "scope_out",
    "project_name",
    "project_description",
    "project_type",
    "target_users",
    "primary_use_cases",
    "success_criteria",
    "agent_models"
  ]);
  const stackKeys = Object.keys(answers).filter(
    (k) => !KNOWN_SUMMARY_IDS.has(k) && answers[k] !== null && answers[k] !== void 0
  );
  if (stackKeys.length > 0) {
    const stackStr = stackKeys.map((k) => {
      const v = answers[k];
      return Array.isArray(v) ? `${k}: ${v.join(", ")}` : `${k}: ${v}`;
    }).join("; ");
    lines.push(`  Stack: ${stackStr}`);
  }
  return lines.join("\n");
}
async function askConfirm({ answers, prompter }) {
  const summary = buildDefinitionSummary(answers);
  console.log("\n--- Captured definition ---");
  if (summary.length > 0) console.log(summary);
  console.log("---------------------------\n");
  const answer = await prompter({
    prompt: "Confirm and create project? [Y/n]",
    type: "string"
  });
  const trimmed = typeof answer === "string" ? answer.trim() : "";
  return trimmed === "" || /^y/i.test(trimmed);
}
function normalizeAgentModelsAnswer(answers) {
  if (!answers || !Object.prototype.hasOwnProperty.call(answers, "agent_models")) {
    return answers;
  }
  const v = answers.agent_models;
  if (v === null || v === void 0 || typeof v === "string" && v.trim().length === 0) {
    const out = { ...answers };
    delete out.agent_models;
    return out;
  }
  if (typeof v === "string") {
    return { ...answers, agent_models: parseAgentModelsAnswer(v) };
  }
  return answers;
}
async function runWizardAndWriteProjectMd({
  repoRoot,
  sessionId,
  prompter,
  now,
  suppliedAnswers,
  skipConfirm,
  packDescriptors = BUILTIN_PACK_DESCRIPTORS,
  packModules = BUILTIN_PACK_MODULES
}) {
  const { activePacks } = loadActivePacks({ descriptors: packDescriptors, moduleRegistry: packModules });
  let answers;
  if (suppliedAnswers) {
    answers = suppliedAnswers;
  } else {
    const persistTo = intakePath(repoRoot, sessionId);
    ({ answers } = await runQuestionnaire({
      questions: collectPackQuestions(buildIntakeQuestions(), activePacks),
      prompter,
      persistTo,
      now
    }));
  }
  answers = normalizeAgentModelsAnswer(answers);
  answers = normalizeDefinitionAnswers(answers);
  if (!skipConfirm && typeof prompter === "function") {
    const confirmed = await askConfirm({ answers, prompter });
    if (!confirmed) {
      return { aborted: true };
    }
  }
  answers = applyProjectMdContributions(activePacks, answers);
  await writeProjectMd({ repoRoot, answers, now });
  await generateProjectContext({ repoRoot, answers, now });
  try {
    await seedBacklog({ repoRoot, answers, now });
  } catch (err) {
    console.warn(
      `backlog seeder failed mid-mint: ${err && err.message ? err.message : err}`
    );
    throw err;
  }
  try {
    await generateUseCaseSuite({ repoRoot, answers, now });
  } catch (err) {
    console.warn(
      `use-case suite generator failed: ${err && err.message ? err.message : err}`
    );
    throw err;
  }
  try {
    materializeWorkflows(repoRoot);
  } catch (err) {
    console.warn(
      `workflow materializer failed: ${err && err.message ? err.message : err}`
    );
    throw err;
  }
  console.log(
    "Task board: use the /hivemind:task-status slash command in Claude Code to open the kanban board."
  );
  try {
    writeClaudeSettings({ repoRoot });
  } catch (err) {
    console.warn(
      `context-monitor settings scaffold failed: ${err && err.message ? err.message : err}`
    );
    throw err;
  }
  return { projectMdPath: (0, import_node_path14.join)(repoRoot, "PROJECT.md") };
}
async function maybeWriteOrchestratorRouting({ repoRoot, prompter, explicitConsent }) {
  if (explicitConsent) {
    writeOrchestratorRouting({ repoRoot });
    return;
  }
  const existing = readProjectClaudeMd(repoRoot);
  if (existing !== null && hasRoutingBlock(existing)) {
    writeOrchestratorRouting({ repoRoot });
    return;
  }
  if (typeof prompter !== "function") return;
  let answer;
  try {
    answer = await prompter({
      prompt: "Add the hivemind orchestrator routing block to this project's CLAUDE.md? It activates the RESUME-FIRST session contract. [y/N]",
      type: "string"
    });
  } catch {
    return;
  }
  const trimmed = typeof answer === "string" ? answer.trim() : "";
  if (/^y/i.test(trimmed)) {
    writeOrchestratorRouting({ repoRoot });
  }
}
async function runInit({
  argv,
  prompter,
  repoRoot,
  now = () => (/* @__PURE__ */ new Date()).toISOString(),
  answers = null,
  packDescriptors = BUILTIN_PACK_DESCRIPTORS,
  packModules = BUILTIN_PACK_MODULES
}) {
  const parsed = parseArgs(argv);
  if (answers) {
    validateSuppliedAnswers(answers);
  }
  const projectMdPath = (0, import_node_path14.join)(repoRoot, "PROJECT.md");
  const projectMdExists = (0, import_node_fs15.existsSync)(projectMdPath);
  if (parsed.applyModels) {
    if (!projectMdExists) {
      console.log("--apply-models: PROJECT.md not found; nothing to apply.");
      return { state: "no_op", projectMdPath, sessionId: null };
    }
    const { answers: projectAnswers } = await readProjectMd({ repoRoot });
    if (!projectAnswers.agent_models || typeof projectAnswers.agent_models !== "object" || Object.keys(projectAnswers.agent_models).length === 0) {
      console.log("--apply-models: no agent_models map in PROJECT.md; nothing to apply.");
      return { state: "no_op", projectMdPath, sessionId: null };
    }
    const changed = await applyAgentModels({
      repoRoot,
      agentModels: projectAnswers.agent_models
    });
    console.log(`--apply-models: updated ${changed.length} file(s): ${changed.join(", ")}`);
    return { state: "applied_models", projectMdPath, sessionId: null };
  }
  if (parsed.applyWorkflows) {
    const { added, skipped } = materializeWorkflows(repoRoot);
    console.log(
      `--apply-workflows: ${added.length} file(s) added` + (added.length > 0 ? ` (${added.join(", ")})` : "") + `; ${skipped.length} file(s) already present and skipped` + (skipped.length > 0 ? ` (${skipped.join(", ")})` : "") + "."
    );
    return { state: "applied_workflows", projectMdPath, sessionId: null };
  }
  if (parsed.applySettings) {
    const { wrote } = writeClaudeSettings({ repoRoot });
    console.log(
      `--apply-settings: .claude/settings.json ${wrote ? "written" : "already up-to-date (no write needed)"}.`
    );
    return { state: "applied_settings", projectMdPath, sessionId: null };
  }
  if (parsed.applyPermissions) {
    if (!projectMdExists) {
      console.log("--apply-permissions: PROJECT.md not found; nothing to apply.");
      return { state: "no_op", projectMdPath, sessionId: null };
    }
    const { answers: projectAnswers } = await readProjectMd({ repoRoot });
    const changed = await applyDeveloperPermissions({
      repoRoot,
      devStack: projectAnswers.dev_stack
    });
    console.log(
      `--apply-permissions: updated ${changed.length} file(s)` + (changed.length > 0 ? `: ${changed.join(", ")}` : ".")
    );
    return { state: "applied_permissions", projectMdPath, sessionId: null };
  }
  const explicitConsent = parsed.claudeMdConsent || Boolean(answers && answers.claude_md_consent === true);
  const skipConfirm = parsed.yes || Boolean(answers);
  if (parsed.force) {
    const { sessionId: sessionId2 } = await startSession({ repoRoot });
    const wResult2 = await runWizardAndWriteProjectMd({
      repoRoot,
      sessionId: sessionId2,
      prompter,
      now,
      suppliedAnswers: answers,
      skipConfirm,
      packDescriptors,
      packModules
    });
    if (wResult2 && wResult2.aborted) {
      console.log("Init cancelled \u2014 no changes written.");
      return { state: "cancelled", projectMdPath, sessionId: sessionId2 };
    }
    await maybeWriteOrchestratorRouting({ repoRoot, prompter, explicitConsent });
    return { state: "forced", projectMdPath, sessionId: sessionId2 };
  }
  if (projectMdExists) {
    const { frontmatter } = await readProjectMd({ repoRoot });
    console.log(
      `Project already initialized: ${frontmatter.name} (${frontmatter.type}, created ${frontmatter.created_at})`
    );
    const pointer2 = readPointer(repoRoot);
    const sessionId2 = pointer2 && pointer2.active_session_id ? pointer2.active_session_id : null;
    return { state: "already_initialized", projectMdPath, sessionId: sessionId2 };
  }
  const pointer = readPointer(repoRoot);
  if (pointer && pointer.active_session_id) {
    const candidatePath = intakePath(repoRoot, pointer.active_session_id);
    const partial = tryReadIntake(candidatePath);
    if (partial) {
      const sessionId2 = pointer.active_session_id;
      const wResult2 = await runWizardAndWriteProjectMd({
        repoRoot,
        sessionId: sessionId2,
        prompter,
        now,
        suppliedAnswers: answers,
        skipConfirm,
        packDescriptors,
        packModules
      });
      if (wResult2 && wResult2.aborted) {
        console.log("Init cancelled \u2014 no changes written.");
        return { state: "cancelled", projectMdPath, sessionId: sessionId2 };
      }
      await maybeWriteOrchestratorRouting({ repoRoot, prompter, explicitConsent });
      return { state: "resumed", projectMdPath, sessionId: sessionId2 };
    }
  }
  if (!answers) {
    await maybeArchiveFrameworkHistory({
      repoRoot,
      prompter,
      noArchive: parsed.noArchive,
      now
    });
  }
  const { sessionId } = await startSession({ repoRoot });
  const wResult = await runWizardAndWriteProjectMd({
    repoRoot,
    sessionId,
    prompter,
    now,
    suppliedAnswers: answers,
    skipConfirm,
    packDescriptors,
    packModules
  });
  if (wResult && wResult.aborted) {
    console.log("Init cancelled \u2014 no changes written.");
    return { state: "cancelled", projectMdPath, sessionId };
  }
  await maybeWriteOrchestratorRouting({ repoRoot, prompter, explicitConsent });
  return { state: "created", projectMdPath, sessionId };
}
function realReadlinePrompter() {
  const rl = (0, import_promises4.createInterface)({ input: import_node_process.stdin, output: import_node_process.stdout });
  return async (ctx) => {
    let text = ctx.prompt;
    if (ctx.type === "enum" && Array.isArray(ctx.enum)) {
      text += ` (${ctx.enum.join(" | ")})`;
    } else if (ctx.type === "multi" && Array.isArray(ctx.enum)) {
      text += ` (comma-separated from: ${ctx.enum.join(", ")})`;
    }
    if (ctx.error) {
      text = `(${ctx.error}) ${text}`;
    }
    return rl.question(`${text} `);
  };
}
var SELF_SUMMARIZING_STATES = /* @__PURE__ */ new Set([
  "already_initialized",
  "applied_workflows",
  "applied_models",
  "applied_settings",
  "applied_permissions",
  "no_op",
  "cancelled"
]);
function printFriendlyOutcome({ state, projectMdPath, sessionId }) {
  if (SELF_SUMMARIZING_STATES.has(state)) {
    return;
  }
  console.log(`* PROJECT.md written to ${projectMdPath}`);
  console.log(`* Session bundle: state/sessions/${sessionId}/`);
  console.log("Next step: start a chat with the orchestrator and ask it to plan the first phase.");
}
function printFriendlyError(err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
function loadAnswersFile(path) {
  let raw;
  try {
    raw = (0, import_node_fs15.readFileSync)(path, "utf8");
  } catch (err) {
    throw new Error(`could not read --answers-file ${path}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`--answers-file ${path} is not valid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`--answers-file ${path} must contain a JSON object of answers`);
  }
  return parsed;
}
var __isEntryScript = import_meta2.url ? Boolean(process.argv[1]) && import_meta2.url === (0, import_node_url2.pathToFileURL)(process.argv[1]).href : typeof require !== "undefined" && typeof module !== "undefined" && require.main === module;
if (__isEntryScript) {
  Promise.resolve().then(() => {
    const argv = process.argv.slice(2);
    const parsed = parseArgs(argv);
    const answers = parsed.answersFile ? loadAnswersFile(parsed.answersFile) : null;
    const prompter = parsed.answersFile ? null : realReadlinePrompter();
    return runInit({
      argv,
      prompter,
      repoRoot: resolveRepoRoot(process.env, process.cwd()),
      answers
    });
  }).then(printFriendlyOutcome).catch(printFriendlyError);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runInit
});
