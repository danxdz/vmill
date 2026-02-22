/* @ts-self-types="./machine_core.d.ts" */

/**
 * @enum {0 | 1}
 */
export const AxisType = Object.freeze({
    Linear: 0, "0": "Linear",
    Rotary: 1, "1": "Rotary",
});

export class MachineBrain {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MachineBrainFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_machinebrain_free(ptr, 0);
    }
    /**
     * @param {string} name
     * @param {AxisType} kind
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    add_axis(name, kind, min, max) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.machinebrain_add_axis(this.__wbg_ptr, ptr0, len0, kind, min, max);
        return ret >>> 0;
    }
    /**
     * @param {number} id
     * @param {any} mappings
     */
    add_channel(id, mappings) {
        wasm.machinebrain_add_channel(this.__wbg_ptr, id, mappings);
    }
    /**
     * @param {string} label
     * @returns {number}
     */
    add_work_offset(label) {
        const ptr0 = passStringToWasm0(label, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.machinebrain_add_work_offset(this.__wbg_ptr, ptr0, len0);
        return ret >>> 0;
    }
    clear_config() {
        wasm.machinebrain_clear_config(this.__wbg_ptr);
    }
    /**
     * @returns {any}
     */
    get_full_state() {
        const ret = wasm.machinebrain_get_full_state(this.__wbg_ptr);
        return ret;
    }
    home_all() {
        wasm.machinebrain_home_all(this.__wbg_ptr);
    }
    /**
     * @param {number} primary_axis_id
     * @param {boolean} rapid
     * @param {number} feed
     */
    home_all_ordered(primary_axis_id, rapid, feed) {
        wasm.machinebrain_home_all_ordered(this.__wbg_ptr, primary_axis_id, rapid, feed);
    }
    /**
     * @param {number} axis_id
     */
    home_axis(axis_id) {
        wasm.machinebrain_home_axis(this.__wbg_ptr, axis_id);
    }
    /**
     * @param {number} axis_id
     * @param {number} delta
     */
    jog_axis(axis_id, delta) {
        wasm.machinebrain_jog_axis(this.__wbg_ptr, axis_id, delta);
    }
    /**
     * @param {number} axis_id
     * @param {number} delta
     * @param {number} feed
     */
    jog_axis_feed(axis_id, delta, feed) {
        wasm.machinebrain_jog_axis_feed(this.__wbg_ptr, axis_id, delta, feed);
    }
    /**
     * @param {number} axis_id
     * @param {number} delta
     */
    jog_axis_rapid(axis_id, delta) {
        wasm.machinebrain_jog_axis_rapid(this.__wbg_ptr, axis_id, delta);
    }
    /**
     * @param {number} channel_index
     * @param {number} delta
     */
    jump_blocks(channel_index, delta) {
        wasm.machinebrain_jump_blocks(this.__wbg_ptr, channel_index, delta);
    }
    /**
     * @param {number} channel_index
     * @param {string} code
     */
    load_program(channel_index, code) {
        const ptr0 = passStringToWasm0(code, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.machinebrain_load_program(this.__wbg_ptr, channel_index, ptr0, len0);
    }
    /**
     * @param {number} axis_id
     * @param {number} target
     */
    move_to(axis_id, target) {
        wasm.machinebrain_move_to(this.__wbg_ptr, axis_id, target);
    }
    constructor() {
        const ret = wasm.machinebrain_new();
        this.__wbg_ptr = ret >>> 0;
        MachineBrainFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} channel_index
     */
    reset_program(channel_index) {
        wasm.machinebrain_reset_program(this.__wbg_ptr, channel_index);
    }
    /**
     * @param {number} channel_index
     * @param {number} slot
     */
    set_active_tool(channel_index, slot) {
        wasm.machinebrain_set_active_tool(this.__wbg_ptr, channel_index, slot);
    }
    /**
     * @param {number} wcs_index
     */
    set_active_wcs(wcs_index) {
        wasm.machinebrain_set_active_wcs(this.__wbg_ptr, wcs_index);
    }
    /**
     * @param {number} axis_id
     * @param {number} accel
     */
    set_axis_accel(axis_id, accel) {
        wasm.machinebrain_set_axis_accel(this.__wbg_ptr, axis_id, accel);
    }
    /**
     * @param {number} axis_id
     * @param {boolean} invert
     */
    set_axis_invert(axis_id, invert) {
        wasm.machinebrain_set_axis_invert(this.__wbg_ptr, axis_id, invert);
    }
    /**
     * @param {number} axis_id
     * @param {number} machine_zero
     */
    set_axis_machine_zero(axis_id, machine_zero) {
        wasm.machinebrain_set_axis_machine_zero(this.__wbg_ptr, axis_id, machine_zero);
    }
    /**
     * @param {number} channel_index
     * @param {number} mode
     */
    set_cutter_comp(channel_index, mode) {
        wasm.machinebrain_set_cutter_comp(this.__wbg_ptr, channel_index, mode);
    }
    /**
     * @param {boolean} s
     */
    set_estop(s) {
        wasm.machinebrain_set_estop(this.__wbg_ptr, s);
    }
    /**
     * @param {number} channel_index
     * @param {number} ratio
     */
    set_feed_override(channel_index, ratio) {
        wasm.machinebrain_set_feed_override(this.__wbg_ptr, channel_index, ratio);
    }
    /**
     * @param {number} channel_index
     * @param {boolean} enabled
     */
    set_single_block(channel_index, enabled) {
        wasm.machinebrain_set_single_block(this.__wbg_ptr, channel_index, enabled);
    }
    /**
     * @param {number} channel_index
     * @param {number} length
     */
    set_tool_length(channel_index, length) {
        wasm.machinebrain_set_tool_length(this.__wbg_ptr, channel_index, length);
    }
    /**
     * @param {number} channel_index
     * @param {boolean} active
     */
    set_tool_length_comp(channel_index, active) {
        wasm.machinebrain_set_tool_length_comp(this.__wbg_ptr, channel_index, active);
    }
    /**
     * @param {number} channel_index
     * @param {number} radius
     */
    set_tool_radius(channel_index, radius) {
        wasm.machinebrain_set_tool_radius(this.__wbg_ptr, channel_index, radius);
    }
    /**
     * @param {number} channel_index
     * @param {number} slot
     * @param {number} length
     * @param {number} radius
     */
    set_tool_table_entry(channel_index, slot, length, radius) {
        wasm.machinebrain_set_tool_table_entry(this.__wbg_ptr, channel_index, slot, length, radius);
    }
    /**
     * @param {number} axis_id
     * @param {number} wcs_index
     * @param {number} machine_pos
     */
    set_work_zero(axis_id, wcs_index, machine_pos) {
        wasm.machinebrain_set_work_zero(this.__wbg_ptr, axis_id, wcs_index, machine_pos);
    }
    /**
     * @param {number} channel_index
     */
    step_once(channel_index) {
        wasm.machinebrain_step_once(this.__wbg_ptr, channel_index);
    }
    /**
     * @param {number} dt_ms
     */
    tick(dt_ms) {
        wasm.machinebrain_tick(this.__wbg_ptr, dt_ms);
    }
    /**
     * @param {number} channel_index
     */
    toggle_pause(channel_index) {
        wasm.machinebrain_toggle_pause(this.__wbg_ptr, channel_index);
    }
}
if (Symbol.dispose) MachineBrain.prototype[Symbol.dispose] = MachineBrain.prototype.free;

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_8c4e43fe74559d73: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_Number_04624de7d0e8332d: function(arg0) {
            const ret = Number(arg0);
            return ret;
        },
        __wbg___wbindgen_boolean_get_bbbb1c18aa2f5e25: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_0bc8482c6e3508ae: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_in_47fa6863be6f2f25: function(arg0, arg1) {
            const ret = arg0 in arg1;
            return ret;
        },
        __wbg___wbindgen_is_function_0095a73b8b156f76: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_object_5ae8e5880f2c1fbd: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_undefined_9e4d92534c42d778: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_jsval_loose_eq_9dd77d8cd6671811: function(arg0, arg1) {
            const ret = arg0 == arg1;
            return ret;
        },
        __wbg___wbindgen_number_get_8ff4255516ccad3e: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_72fb696202c56729: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_be289d5034ed271b: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_389efe28435a9388: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.call(arg1);
            return ret;
        }, arguments); },
        __wbg_done_57b39ecd9addfe81: function(arg0) {
            const ret = arg0.done;
            return ret;
        },
        __wbg_get_9b94d73e6221f75c: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_b3ed3ad4be2bc8ac: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_with_ref_key_1dc361bd10053bfe: function(arg0, arg1) {
            const ret = arg0[arg1];
            return ret;
        },
        __wbg_instanceof_ArrayBuffer_c367199e2fa2aa04: function(arg0) {
            let result;
            try {
                result = arg0 instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_9b9075935c74707c: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isArray_d314bb98fcf08331: function(arg0) {
            const ret = Array.isArray(arg0);
            return ret;
        },
        __wbg_isSafeInteger_bfbc7332a9768d2a: function(arg0) {
            const ret = Number.isSafeInteger(arg0);
            return ret;
        },
        __wbg_iterator_6ff6560ca1568e55: function() {
            const ret = Symbol.iterator;
            return ret;
        },
        __wbg_length_32ed9a279acd054c: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_35a7bace40f36eac: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_log_56fa787a21bba056: function(arg0, arg1) {
            console.log(getStringFromWasm0(arg0, arg1));
        },
        __wbg_new_361308b2356cecd0: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_3eb36ae241fe6f44: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_dd2b680c8bf6ae29: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_next_3482f54c49e8af19: function() { return handleError(function (arg0) {
            const ret = arg0.next();
            return ret;
        }, arguments); },
        __wbg_next_418f80d8f5303233: function(arg0) {
            const ret = arg0.next;
            return ret;
        },
        __wbg_prototypesetcall_bdcdcc5842e4d77d: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_set_3f1d0b984ed272ed: function(arg0, arg1, arg2) {
            arg0[arg1] = arg2;
        },
        __wbg_set_f43e577aea94465b: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_value_0546255b415e96c1: function(arg0) {
            const ret = arg0.value;
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./machine_core_bg.js": import0,
    };
}

const MachineBrainFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_machinebrain_free(ptr >>> 0, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('machine_core_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
