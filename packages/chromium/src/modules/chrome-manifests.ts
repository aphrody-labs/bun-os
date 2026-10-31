// SPDX-License-Identifier: MIT
// Chrome extension and web app manifest validation (fork src/js/internal/chrome-manifests.ts).
const ObjectKeys = Object.keys;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectDefineProperty = Object.defineProperty;
const ObjectPrototype = Object.prototype;
const NumberIsFinite = Number.isFinite;
const RegExpExec = RegExp.prototype.exec;
const StringSplit = String.prototype.split as (this: string, separator: string) => string[];
const StringTrim = String.prototype.trim;
const StringStartsWith = String.prototype.startsWith;
const ArrayIncludes = Array.prototype.includes;
const URLConstructor = URL;

function matches(pattern: RegExp, value: string) {
  return RegExpExec.call(pattern, value) !== null;
}

function object(value: any, field: string) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function string(value: any, field: string) {
  if (typeof value !== "string" || StringTrim.call(value).length === 0 || matches(/\0/, value)) {
    throw new TypeError(`${field} must be a nonempty string without NUL characters`);
  }
  return value;
}

function array(value: any, field: string) {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return value;
}

function copyJSON(value: any, field: string, ancestors: any[] = []): any {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && NumberIsFinite(value)) return value;
  if (typeof value !== "object") throw new TypeError(`${field} must contain JSON values`);
  for (let i = 0; i < ancestors.length; i++) {
    if (ancestors[i] === value) throw new TypeError(`${field} must not contain a cycle`);
  }
  const isArray = Array.isArray(value);
  if (!isArray) {
    const prototype = ObjectGetPrototypeOf(value);
    if (prototype !== null && prototype !== ObjectPrototype) {
      throw new TypeError(`${field} must contain plain JSON objects`);
    }
  }
  ancestors[ancestors.length] = value;
  const result: any = isArray ? [] : { __proto__: null };
  if (isArray) {
    for (let i = 0; i < value.length; i++) result[i] = copyJSON(value[i], `${field}[${i}]`, ancestors);
  } else {
    const keys = ObjectKeys(value);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      ObjectDefineProperty(result, key, {
        value: copyJSON(value[key], `${field}.${key}`, ancestors),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  ancestors.length--;
  return result;
}

function resource(value: any, field: string) {
  string(value, field);
  if (matches(/^[\\/]|[\\\0?#:]|(^|\/)\.\.?($|\/)/, value)) {
    throw new TypeError(`${field} must be a relative package resource without traversal`);
  }
  // Encoded separators and dot segments become traversal when used as extension URLs.
  if (matches(/%(?:00|2e|2f|5c)/i, value)) {
    throw new TypeError(`${field} must not contain encoded path separators or dot segments`);
  }
}

function resources(value: any, field: string) {
  const items = array(value, field);
  for (let i = 0; i < items.length; i++) resource(items[i], `${field}[${i}]`);
}

function resourceMap(value: any, field: string) {
  object(value, field);
  const keys = ObjectKeys(value);
  for (let i = 0; i < keys.length; i++) resource(value[keys[i]], `${field}.${keys[i]}`);
}

function identity(manifest: any) {
  string(manifest.name, "name");
  string(manifest.version, "version");
  if (manifest.manifest_version !== 3) throw new RangeError("manifest_version must be 3");
  if (!matches(/^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/, manifest.version)) {
    throw new TypeError("version must contain one to four dot-separated integers without leading zeros");
  }
  const parts = StringSplit.call(manifest.version, ".");
  let nonzero = false;
  for (let i = 0; i < parts.length; i++) {
    const part = +parts[i];
    if (part > 65535) throw new RangeError("version components must not exceed 65535");
    if (part !== 0) nonzero = true;
  }
  if (!nonzero) throw new RangeError("version must not be all zero");
  const icons = manifest.icons;
  if (icons !== undefined) resourceMap(icons, "icons");
}

function hostPattern(value: any, field: string) {
  string(value, field);
  if (value === "<all_urls>") return;
  if (!matches(/^(\*|https?|file|ftp):\/\/([^/]+|)\/[^\s\0]*$/, value)) {
    throw new TypeError(`${field} must be a Chrome host match pattern`);
  }
  const parts = StringSplit.call(value, "/");
  const scheme = parts[0];
  const host = parts[2];
  if (scheme === "file:") {
    if (host !== "") throw new TypeError(`${field} file patterns must have an empty host`);
  } else if (
    !host ||
    matches(/[@:#?\\\s]/, host) ||
    (matches(/\*/, host) && host !== "*" && !matches(/^\*\.[^*]+$/, host))
  ) {
    throw new TypeError(`${field} has an invalid host`);
  }
}

function permissions(value: any, field: string, hosts: boolean) {
  const items = array(value, field);
  for (let i = 0; i < items.length; i++) {
    const name = `${field}[${i}]`;
    if (hosts) hostPattern(items[i], name);
    else if (!matches(/^[a-zA-Z][a-zA-Z0-9_.]*$/, string(items[i], name))) {
      throw new TypeError(`${name} must be a permission name; use host_permissions for host patterns`);
    }
  }
}

function validateExtension(input: any) {
  const manifest = copyJSON(object(input, "manifest"), "manifest");
  identity(manifest);
  if (manifest.theme !== undefined) throw new TypeError("Extension manifests must not contain theme");
  for (const key of ["browser_action", "page_action"]) {
    if (manifest[key] !== undefined) throw new TypeError(`Manifest V3 must use action instead of ${key}`);
  }
  for (const key of ["permissions", "optional_permissions", "host_permissions", "optional_host_permissions"]) {
    const value = manifest[key];
    if (value !== undefined) permissions(value, key, key === "host_permissions" || key === "optional_host_permissions");
  }
  const backgroundValue = manifest.background;
  if (backgroundValue !== undefined) {
    const background = object(backgroundValue, "background");
    resource(background.service_worker, "background.service_worker");
    if (background.scripts !== undefined || background.page !== undefined || background.persistent !== undefined) {
      throw new TypeError("Manifest V3 background must use service_worker instead of scripts, page or persistent");
    }
    const type = background.type;
    if (type !== undefined && type !== "module") throw new TypeError('background.type must be "module"');
  }
  const actionValue = manifest.action;
  if (actionValue !== undefined) {
    const action = object(actionValue, "action");
    const popup = action.default_popup;
    if (popup !== undefined && popup !== "") resource(popup, "action.default_popup");
    const icon = action.default_icon;
    if (typeof icon === "string") resource(icon, "action.default_icon");
    else if (icon !== undefined) resourceMap(icon, "action.default_icon");
  }
  const sidePanel = manifest.side_panel;
  if (sidePanel !== undefined) {
    resource(object(sidePanel, "side_panel").default_path, "side_panel.default_path");
  }
  const devtoolsPage = manifest.devtools_page;
  if (devtoolsPage !== undefined) resource(devtoolsPage, "devtools_page");
  const optionsPage = manifest.options_page;
  if (optionsPage !== undefined) resource(optionsPage, "options_page");
  const optionsUI = manifest.options_ui;
  if (optionsUI !== undefined) resource(object(optionsUI, "options_ui").page, "options_ui.page");
  const overrides = manifest.chrome_url_overrides;
  if (overrides !== undefined) resourceMap(overrides, "chrome_url_overrides");
  const contentScripts = manifest.content_scripts;
  if (contentScripts !== undefined) {
    const scripts = array(contentScripts, "content_scripts");
    for (let i = 0; i < scripts.length; i++) {
      const entry = object(scripts[i], `content_scripts[${i}]`);
      const js = entry.js;
      const css = entry.css;
      if (js !== undefined) resources(js, `content_scripts[${i}].js`);
      if (css !== undefined) resources(css, `content_scripts[${i}].css`);
      permissions(entry.matches, `content_scripts[${i}].matches`, true);
    }
  }
  const webResources = manifest.web_accessible_resources;
  if (webResources !== undefined) {
    const entries = array(webResources, "web_accessible_resources");
    for (let i = 0; i < entries.length; i++) {
      const entry = object(entries[i], `web_accessible_resources[${i}]`);
      resources(entry.resources, `web_accessible_resources[${i}].resources`);
      const matchesValue = entry.matches;
      if (matchesValue !== undefined) permissions(matchesValue, `web_accessible_resources[${i}].matches`, true);
    }
  }
  return manifest;
}

function createExtension(input: any) {
  return validateExtension({ manifest_version: 3, version: "1.0.0", ...object(input, "options") });
}

function validateTheme(input: any) {
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
    "omnibox",
  ]) {
    if (manifest[key] !== undefined) throw new TypeError(`Theme manifests must not contain ${key}`);
  }
  const images = theme.images;
  if (images !== undefined) resourceMap(images, "theme.images");
  for (const key of ["colors", "tints"]) {
    const value = theme[key];
    if (value === undefined) continue;
    const values = object(value, `theme.${key}`);
    for (const name of ObjectKeys(values)) {
      const field = `theme.${key}.${name}`;
      const components = array(values[name], field);
      if (components.length !== 3 && !(key === "colors" && components.length === 4)) {
        throw new TypeError(`${field} must have three components${key === "colors" ? " or four for RGBA" : ""}`);
      }
      for (let i = 0; i < components.length; i++) {
        const component = components[i];
        if (typeof component !== "number" || !NumberIsFinite(component))
          throw new TypeError(`${field}[${i}] must be finite`);
        if (key === "tints") {
          if (component !== -1 && (component < 0 || component > 1))
            throw new RangeError(`${field}[${i}] must be -1 or between 0 and 1`);
        } else if (component < 0 || component > (i === 3 ? 1 : 255) || (i < 3 && component % 1 !== 0)) {
          throw new RangeError(
            `${field}[${i}] must be ${i === 3 ? "between 0 and 1" : "an integer between 0 and 255"}`,
          );
        }
      }
    }
  }
  return manifest;
}

function createTheme(input: any) {
  return validateTheme({
    manifest_version: 3,
    version: "1.0.0",
    theme: {},
    ...object(input, "options"),
  });
}

function httpURL(value: any, field: string, base?: string) {
  string(value, field);
  const url = new URLConstructor(value, base);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new TypeError(`${field} must use HTTP or HTTPS`);
  if (url.username || url.password) throw new TypeError(`${field} must not contain credentials`);
  return url;
}

function validatePWA(input: any) {
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
    for (let i = 0; i < icons.length; i++) {
      const icon = object(icons[i], `icons[${i}]`);
      icon.src = httpURL(icon.src, `icons[${i}].src`, start.href).href;
      const sizes = icon.sizes;
      if (
        sizes !== undefined &&
        !matches(/^(any|[1-9]\d*x[1-9]\d*)( +(any|[1-9]\d*x[1-9]\d*))*$/, string(sizes, `icons[${i}].sizes`))
      ) {
        throw new TypeError(`icons[${i}].sizes must contain dimensions or any`);
      }
      const type = icon.type;
      if (type !== undefined) string(type, `icons[${i}].type`);
      const purpose = icon.purpose;
      if (
        purpose !== undefined &&
        !matches(/^(any|maskable|monochrome)( +(any|maskable|monochrome))*$/, string(purpose, `icons[${i}].purpose`))
      ) {
        throw new TypeError(`icons[${i}].purpose must contain any, maskable or monochrome`);
      }
    }
  }
  return manifest;
}

function createPWA(input: any) {
  const manifest = { display: "standalone", ...object(input, "options") };
  return validatePWA(manifest);
}

export default {
  validateExtension,
  createExtension,
  validateTheme,
  createTheme,
  validatePWA,
  createPWA,
};
