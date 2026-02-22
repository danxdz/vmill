/* tslint:disable */
/* eslint-disable */

export enum AxisType {
    Linear = 0,
    Rotary = 1,
}

export class MachineBrain {
    free(): void;
    [Symbol.dispose](): void;
    add_axis(name: string, kind: AxisType, min: number, max: number): number;
    add_channel(id: number, mappings: any): void;
    add_work_offset(label: string): number;
    clear_config(): void;
    get_full_state(): any;
    home_all(): void;
    home_all_ordered(primary_axis_id: number, rapid: boolean, feed: number): void;
    home_axis(axis_id: number): void;
    jog_axis(axis_id: number, delta: number): void;
    jog_axis_feed(axis_id: number, delta: number, feed: number): void;
    jog_axis_rapid(axis_id: number, delta: number): void;
    jump_blocks(channel_index: number, delta: number): void;
    load_program(channel_index: number, code: string): void;
    move_to(axis_id: number, target: number): void;
    constructor();
    reset_program(channel_index: number): void;
    set_active_tool(channel_index: number, slot: number): void;
    set_active_wcs(wcs_index: number): void;
    set_axis_accel(axis_id: number, accel: number): void;
    set_axis_invert(axis_id: number, invert: boolean): void;
    set_axis_machine_zero(axis_id: number, machine_zero: number): void;
    set_cutter_comp(channel_index: number, mode: number): void;
    set_estop(s: boolean): void;
    set_feed_override(channel_index: number, ratio: number): void;
    set_single_block(channel_index: number, enabled: boolean): void;
    set_tool_length(channel_index: number, length: number): void;
    set_tool_length_comp(channel_index: number, active: boolean): void;
    set_tool_radius(channel_index: number, radius: number): void;
    set_tool_table_entry(channel_index: number, slot: number, length: number, radius: number): void;
    set_work_zero(axis_id: number, wcs_index: number, machine_pos: number): void;
    step_once(channel_index: number): void;
    tick(dt_ms: number): void;
    toggle_pause(channel_index: number): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_machinebrain_free: (a: number, b: number) => void;
    readonly machinebrain_add_axis: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly machinebrain_add_channel: (a: number, b: number, c: any) => void;
    readonly machinebrain_add_work_offset: (a: number, b: number, c: number) => number;
    readonly machinebrain_clear_config: (a: number) => void;
    readonly machinebrain_get_full_state: (a: number) => any;
    readonly machinebrain_home_all: (a: number) => void;
    readonly machinebrain_home_all_ordered: (a: number, b: number, c: number, d: number) => void;
    readonly machinebrain_home_axis: (a: number, b: number) => void;
    readonly machinebrain_jog_axis: (a: number, b: number, c: number) => void;
    readonly machinebrain_jog_axis_feed: (a: number, b: number, c: number, d: number) => void;
    readonly machinebrain_jog_axis_rapid: (a: number, b: number, c: number) => void;
    readonly machinebrain_jump_blocks: (a: number, b: number, c: number) => void;
    readonly machinebrain_load_program: (a: number, b: number, c: number, d: number) => void;
    readonly machinebrain_move_to: (a: number, b: number, c: number) => void;
    readonly machinebrain_new: () => number;
    readonly machinebrain_reset_program: (a: number, b: number) => void;
    readonly machinebrain_set_active_tool: (a: number, b: number, c: number) => void;
    readonly machinebrain_set_active_wcs: (a: number, b: number) => void;
    readonly machinebrain_set_axis_accel: (a: number, b: number, c: number) => void;
    readonly machinebrain_set_axis_invert: (a: number, b: number, c: number) => void;
    readonly machinebrain_set_axis_machine_zero: (a: number, b: number, c: number) => void;
    readonly machinebrain_set_cutter_comp: (a: number, b: number, c: number) => void;
    readonly machinebrain_set_estop: (a: number, b: number) => void;
    readonly machinebrain_set_feed_override: (a: number, b: number, c: number) => void;
    readonly machinebrain_set_single_block: (a: number, b: number, c: number) => void;
    readonly machinebrain_set_tool_length: (a: number, b: number, c: number) => void;
    readonly machinebrain_set_tool_length_comp: (a: number, b: number, c: number) => void;
    readonly machinebrain_set_tool_radius: (a: number, b: number, c: number) => void;
    readonly machinebrain_set_tool_table_entry: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly machinebrain_set_work_zero: (a: number, b: number, c: number, d: number) => void;
    readonly machinebrain_step_once: (a: number, b: number) => void;
    readonly machinebrain_tick: (a: number, b: number) => void;
    readonly machinebrain_toggle_pause: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
