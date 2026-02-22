use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use std::collections::{HashMap, VecDeque};

// --- LOGGING ---
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[cfg(not(target_arch = "wasm32"))]
fn log(_s: &str) {}
macro_rules! console_log {
    ($($t:tt)*) => (log(&format!($($t)*)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq(a: f64, b: f64) {
        assert!(
            (a - b).abs() <= 1e-6,
            "expected {:.6}, got {:.6} (|diff|={:.6})",
            b,
            a,
            (a - b).abs()
        );
    }

    fn make_xyz_brain() -> MachineBrain {
        let mut brain = MachineBrain::new();
        let x = brain.add_axis("X".to_string(), AxisType::Linear, -10_000.0, 10_000.0);
        let y = brain.add_axis("Y".to_string(), AxisType::Linear, -10_000.0, 10_000.0);
        let z = brain.add_axis("Z".to_string(), AxisType::Linear, -10_000.0, 10_000.0);

        brain.channels.push(Channel {
            id: 0,
            axis_map: vec![
                ChannelAxisMap { axis_id: x, display_label: "X".to_string() },
                ChannelAxisMap { axis_id: y, display_label: "Y".to_string() },
                ChannelAxisMap { axis_id: z, display_label: "Z".to_string() },
            ],
            is_running: false,
            paused: false,
            pc: 0,
            active_pc: -1,
            program: Vec::new(),
            feed_rate: 1000.0,
            current_motion: 0,
            abs_mode: true,
            units_mm: true,
            plane: 17,
            exact_stop: false,
            cutter_comp: 40,
            tool_radius: 4.0,
            length_comp_active: false,
            tool_length: 50.0,
            active_tool: 0,
            active_d: 0,
            active_h: 0,
            spindle_rpm: 0.0,
            spindle_mode: 5,
            coolant_on: false,
            feed_override: 1.0,
            single_block: false,
            step_once: false,
            pause_pending: false,
            tool_table: HashMap::from([
                (0, ToolTableEntry { radius: 4.0, length: 50.0 }),
                (1, ToolTableEntry { radius: 4.0, length: 50.0 }),
            ]),
            comp_linear_prev: None,
            comp_entry_pending: false,
            pending: VecDeque::new(),
            programmed_work: HashMap::new(),
        });

        brain
    }

    #[test]
    fn g41_offsets_left_and_does_not_accumulate_on_straight_path() {
        let mut brain = make_xyz_brain();

        brain.parse_line(0, "G90 G21 G40");
        brain.parse_line(0, "G1 X0 Y0");
        brain.parse_line(0, "G41 D2 G1 X10 Y0");
        approx_eq(brain.axes[0].target, 10.0);
        approx_eq(brain.axes[1].target, 2.0);

        brain.parse_line(0, "G1 X20 Y0");
        approx_eq(brain.axes[0].target, 20.0);
        approx_eq(brain.axes[1].target, 2.0);
        approx_eq(brain.channels[0].programmed_work.get(&1).copied().unwrap_or(0.0), 0.0);
    }

    #[test]
    fn g42_offsets_right_on_straight_path() {
        let mut brain = make_xyz_brain();

        brain.parse_line(0, "G90 G21 G40");
        brain.parse_line(0, "G1 X0 Y0");
        brain.parse_line(0, "G42 D2 G1 X10 Y0");
        approx_eq(brain.axes[0].target, 10.0);
        approx_eq(brain.axes[1].target, -2.0);
    }

    #[test]
    fn g41_g42_arc_side_is_consistent() {
        // Start at +X on a 10mm radius circle centered at 0,0.
        // CCW quarter arc to +Y. With this implementation:
        // G41 = left of travel => inward on CCW circle (R -> 8)
        // G42 = right of travel => outward on CCW circle (R -> 12)
        let mut brain_l = make_xyz_brain();
        brain_l.parse_line(0, "G90 G21 G40");
        brain_l.parse_line(0, "G1 X10 Y0");
        brain_l.parse_line(0, "G41 D2 G3 X0 Y10 I-10 J0");
        let last_g41 = brain_l.channels[0]
            .pending
            .back()
            .expect("expected arc segments for G41")
            .clone();
        let g41_y = last_g41.iter().find(|(id, _)| *id == 1).map(|(_, v)| *v).unwrap_or(0.0);
        approx_eq(g41_y, 8.0);

        let mut brain_r = make_xyz_brain();
        brain_r.parse_line(0, "G90 G21 G40");
        brain_r.parse_line(0, "G1 X10 Y0");
        brain_r.parse_line(0, "G42 D2 G3 X0 Y10 I-10 J0");
        let last_g42 = brain_r.channels[0]
            .pending
            .back()
            .expect("expected arc segments for G42")
            .clone();
        let g42_y = last_g42.iter().find(|(id, _)| *id == 1).map(|(_, v)| *v).unwrap_or(0.0);
        approx_eq(g42_y, 12.0);
    }

    #[test]
    fn g40_cancel_returns_to_programmed_path() {
        let mut brain = make_xyz_brain();

        brain.parse_line(0, "G90 G21 G40");
        brain.parse_line(0, "G1 X0 Y0");
        brain.parse_line(0, "G41 D2 G1 X10 Y0");
        approx_eq(brain.axes[1].target, 2.0);

        brain.parse_line(0, "G40 G1 X20 Y0");
        approx_eq(brain.axes[0].target, 20.0);
        // G40 with axis motion keeps previous comp for this block.
        approx_eq(brain.axes[1].target, 2.0);

        // Next block runs uncompensated.
        brain.parse_line(0, "G1 X30 Y0");
        approx_eq(brain.axes[0].target, 30.0);
        approx_eq(brain.axes[1].target, 0.0);
    }

    #[test]
    fn g40_on_motion_uses_previous_comp_for_that_block() {
        let mut brain = make_xyz_brain();
        brain.parse_line(0, "G90 G21 G40");
        brain.parse_line(0, "G1 X0 Y0");
        brain.parse_line(0, "G41 D2 G1 X10 Y0");
        approx_eq(brain.axes[1].target, 2.0);

        // Cancel on a motion block: this block should still run compensated, then turn comp off.
        brain.parse_line(0, "G1 G40 X20 Y0");
        approx_eq(brain.axes[0].target, 20.0);
        approx_eq(brain.axes[1].target, 2.0);
        assert_eq!(brain.channels[0].cutter_comp, 40);
    }

    #[test]
    fn g41_without_axis_words_is_modal_only_and_does_not_move() {
        let mut brain = make_xyz_brain();

        brain.parse_line(0, "G90 G21 G1 X5 Y6 Z7");
        approx_eq(brain.axes[0].target, 5.0);
        approx_eq(brain.axes[1].target, 6.0);
        approx_eq(brain.axes[2].target, 7.0);

        brain.parse_line(0, "G41 D3");
        approx_eq(brain.axes[0].target, 5.0);
        approx_eq(brain.axes[1].target, 6.0);
        approx_eq(brain.axes[2].target, 7.0);
        assert_eq!(brain.channels[0].cutter_comp, 41);
        approx_eq(brain.channels[0].tool_radius, 3.0);
    }

    #[test]
    fn g41_armed_on_z_move_engages_on_next_xy_feed_move() {
        let mut brain = make_xyz_brain();
        brain.parse_line(0, "G90 G21 G40");
        brain.parse_line(0, "G0 X10 Y-10");
        brain.parse_line(0, "G41 D3 G1 Z-5");
        assert_eq!(brain.channels[0].cutter_comp, 41);
        assert!(brain.channels[0].comp_entry_pending);

        brain.parse_line(0, "G1 X50 Y-10");
        assert!(!brain.channels[0].comp_entry_pending);

        // First target is entry point on offset line.
        approx_eq(brain.axes[0].target, 10.0);
        approx_eq(brain.axes[1].target, -7.0);

        // Then queued final target follows the offset contour.
        let final_seg = brain.channels[0].pending.back().expect("expected queued final segment");
        let fx = final_seg
            .iter()
            .find(|(id, _)| *id == 0)
            .map(|(_, v)| *v)
            .unwrap_or(f64::NAN);
        let fy = final_seg
            .iter()
            .find(|(id, _)| *id == 1)
            .map(|(_, v)| *v)
            .unwrap_or(f64::NAN);
        approx_eq(fx, 50.0);
        approx_eq(fy, -7.0);
    }

    #[test]
    fn repeated_g41_on_engage_block_keeps_pending_entry_behavior() {
        let mut brain = make_xyz_brain();
        brain.set_tool_radius(0, 10.0);
        brain.parse_line(0, "G90 G21 G40");
        brain.parse_line(0, "G0 X-10 Y-40");
        // Arm comp on a non-XY block.
        brain.parse_line(0, "G41 Z-5");
        assert!(brain.channels[0].comp_entry_pending);

        // Repeating G41 on the first XY feed block should still perform entry transition.
        brain.parse_line(0, "G1 G41 H0 X0 Y-50 F200");
        assert!(!brain.channels[0].comp_entry_pending);
        assert!(
            !brain.channels[0].pending.is_empty(),
            "expected queued final segment after entry transition"
        );
        approx_eq(brain.axes[0].target, -2.9289321881345254);
        approx_eq(brain.axes[1].target, -32.928932188134524);
    }

    #[test]
    fn d0_uses_tool_table_slot_zero_radius() {
        let mut brain = make_xyz_brain();
        brain.set_tool_radius(0, 4.0);

        brain.parse_line(0, "G90 G21 G1 X0 Y0");
        brain.parse_line(0, "G41 D0 G1 X10 Y0");

        approx_eq(brain.channels[0].tool_radius, 4.0);
        approx_eq(brain.axes[1].target, 4.0);
    }

    #[test]
    fn h0_uses_tool_table_slot_zero_length() {
        let mut brain = make_xyz_brain();
        brain.set_tool_length(0, 50.0);

        brain.parse_line(0, "G90 G21 G43 H0 G1 Z0");

        approx_eq(brain.channels[0].tool_length, 50.0);
        approx_eq(brain.axes[2].target, 50.0);
    }

    #[test]
    fn t0_unloads_tool_and_cancels_comp() {
        let mut brain = make_xyz_brain();
        brain.parse_line(0, "G90 G21");
        brain.parse_line(0, "G43 H1");
        brain.parse_line(0, "G41 D1");
        assert_eq!(brain.channels[0].active_tool, 0);
        assert!(brain.channels[0].length_comp_active);
        assert_eq!(brain.channels[0].cutter_comp, 41);

        brain.parse_line(0, "T0");
        assert_eq!(brain.channels[0].active_tool, 0);
        approx_eq(brain.channels[0].tool_length, 0.0);
        approx_eq(brain.channels[0].tool_radius, 0.0);
        assert!(!brain.channels[0].length_comp_active);
        assert_eq!(brain.channels[0].cutter_comp, 40);
    }

    #[test]
    fn comp_updates_orthogonal_axis_and_inserts_corner_transition() {
        let mut brain = make_xyz_brain();
        brain.parse_line(0, "G90 G21 G40 G1 X0 Y0");
        brain.parse_line(0, "G41 D1 G1 X10");
        // First compensated single-axis block inserts an entry point onto the offset line.
        approx_eq(brain.axes[0].target, 0.0);
        approx_eq(brain.axes[1].target, 4.0);
        let first_final = brain.channels[0].pending.back().expect("expected final entry move");
        let x1 = first_final.iter().find(|(id, _)| *id == 0).map(|(_, v)| *v).unwrap_or(f64::NAN);
        let y1 = first_final.iter().find(|(id, _)| *id == 1).map(|(_, v)| *v).unwrap_or(f64::NAN);
        approx_eq(x1, 10.0);
        approx_eq(y1, 4.0);

        brain.axes[0].position = 10.0;
        brain.axes[1].position = 4.0;
        brain.parse_line(0, "G1 Y10");

        // Inside corner uses miter join at intersection (6,4), then final endpoint (6,10).
        approx_eq(brain.axes[0].target, 6.0);
        approx_eq(brain.axes[1].target, 4.0);
        let last = brain.channels[0].pending.back().expect("expected queued final segment");
        let x = last.iter().find(|(id, _)| *id == 0).map(|(_, v)| *v).unwrap_or(f64::NAN);
        let y = last.iter().find(|(id, _)| *id == 1).map(|(_, v)| *v).unwrap_or(f64::NAN);
        approx_eq(x, 6.0);
        approx_eq(y, 10.0);
    }

    #[test]
    fn g20_g21_units_modal_scales_coordinates() {
        let mut brain = make_xyz_brain();
        brain.parse_line(0, "G90 G21 G1 X10");
        approx_eq(brain.axes[0].target, 10.0);

        brain.parse_line(0, "G20 G1 X1");
        approx_eq(brain.axes[0].target, 25.4);

        brain.parse_line(0, "G21 G1 X2");
        approx_eq(brain.axes[0].target, 2.0);
    }

    #[test]
    fn g90_g91_distance_mode_switches_absolute_incremental() {
        let mut brain = make_xyz_brain();
        brain.parse_line(0, "G90 G21 G1 X10");
        approx_eq(brain.axes[0].target, 10.0);

        brain.parse_line(0, "G91 G1 X5");
        approx_eq(brain.axes[0].target, 15.0);

        brain.parse_line(0, "G91 G1 X-2");
        approx_eq(brain.axes[0].target, 13.0);

        brain.parse_line(0, "G90 G1 X7");
        approx_eq(brain.axes[0].target, 7.0);
    }

    #[test]
    fn parser_accepts_spaces_after_word_address() {
        let mut brain = make_xyz_brain();
        brain.parse_line(0, "G90 G21 G1 X 10 Y -5 Z 2");
        approx_eq(brain.axes[0].target, 10.0);
        approx_eq(brain.axes[1].target, -5.0);
        approx_eq(brain.axes[2].target, 2.0);
    }

    #[test]
    fn feed_rate_is_modal_until_changed() {
        let mut brain = make_xyz_brain();
        brain.parse_line(0, "G90 G21 F1200");
        approx_eq(brain.channels[0].feed_rate, 1200.0);

        brain.parse_line(0, "G1 X10");
        approx_eq(brain.channels[0].feed_rate, 1200.0);

        brain.parse_line(0, "F800");
        approx_eq(brain.channels[0].feed_rate, 800.0);
    }

    #[test]
    fn estop_clears_pending_queue_and_freezes_targets() {
        let mut brain = make_xyz_brain();
        brain.parse_line(0, "G90 G21 G1 X10 Y0");
        brain.parse_line(0, "G2 X0 Y10 I-10 J0");
        assert!(
            !brain.channels[0].pending.is_empty(),
            "expected pending segments before estop"
        );
        brain.axes[0].position = 3.2;
        brain.axes[1].position = -1.4;
        brain.axes[2].position = 7.0;

        brain.set_estop(true);
        assert!(brain.channels[0].pending.is_empty(), "pending queue must be cleared");
        approx_eq(brain.axes[0].target, 3.2);
        approx_eq(brain.axes[1].target, -1.4);
        approx_eq(brain.axes[2].target, 7.0);
    }
}
#[wasm_bindgen]
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq)]
pub enum AxisType { Linear, Rotary }

#[derive(Serialize, Clone)]
pub struct Axis {
    pub id: u32,
    pub physical_name: String,
    pub position: f64,
    pub target: f64,
    pub axis_type: AxisType,
    pub min_range: f64,
    pub max_range: f64,
    pub homed: bool,
    pub velocity: f64,   // current speed mm/min
    pub accel: f64,      // mm/min per second²
    pub invert: bool,    // flip direction in 3D view
    pub machine_zero: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ChannelAxisMap {
    pub axis_id: u32,
    pub display_label: String,
}

#[derive(Serialize)]
pub struct ChannelStatus {
    pub id: u32,
    pub is_running: bool,
    pub paused: bool,
    pub active_pc: i32,
    pub pc: usize,
    pub axis_map: Vec<ChannelAxisMap>,
    pub current_motion: i32,
    pub exact_stop: bool,
    pub cutter_comp: i32,
    pub tool_radius: f64,
    pub length_comp_active: bool,
    pub tool_length: f64,
    pub active_tool: i32,
    pub active_d: i32,
    pub active_h: i32,
    pub spindle_rpm: f64,
    pub spindle_mode: i32,
    pub coolant_on: bool,
    pub feed_rate: f64,
    pub feed_override: f64,
    pub single_block: bool,
    pub programmed_work: Vec<AxisOffset>,
}

pub struct Channel {
    pub id: u32,
    pub axis_map: Vec<ChannelAxisMap>,
    pub is_running: bool,
    pub paused: bool,
    pub pc: usize,
    pub active_pc: i32,
    pub program: Vec<String>,
    pub feed_rate: f64,
    pub current_motion: i32, // last commanded motion mode (0/1/2/3)

    // --- Simple modal state (per-channel) ---
    pub abs_mode: bool,      // G90/G91
    pub units_mm: bool,      // G21(true)/G20(false)
    pub plane: u8,           // 17=XY only for now
    pub exact_stop: bool,    // G61 exact-stop / G64 continuous
    pub cutter_comp: i32,    // 40/41/42
    pub tool_radius: f64,    // D value (mm)
    pub length_comp_active: bool, // G43/G49
    pub tool_length: f64,    // H value (mm)
    pub active_tool: i32,    // T value
    pub active_d: i32,       // Active D slot number
    pub active_h: i32,       // Active H slot number
    pub spindle_rpm: f64,    // S value (RPM)
    pub spindle_mode: i32,   // M3/M4/M5
    pub coolant_on: bool,    // M8/M9
    pub feed_override: f64,  // 0.0..2.0 multiplier
    pub single_block: bool,  // stop after each completed block
    pub step_once: bool,     // run one block then hold
    pub pause_pending: bool, // internal: wait block completion then pause
    // Tool compensation table, indexed by D/H number.
    // Slot 0 is treated as the active/default tool.
    tool_table: HashMap<i32, ToolTableEntry>,
    // Last compensated linear segment for corner intersection smoothing.
    comp_linear_prev: Option<CompLinearState>,
    // True when G41/G42 was armed without an XY move and still needs first-entry transition.
    comp_entry_pending: bool,
    // Pending linear targets (expanded arcs). Each entry is (axis_id, machine_target)
    pending: VecDeque<Vec<(u32, f64)>>,
    // Programmed work-coordinate position (uncompensated geometry), per axis.
    programmed_work: HashMap<u32, f64>,
}

#[derive(Clone, Copy)]
struct ToolTableEntry {
    radius: f64,
    length: f64,
}

#[derive(Clone, Copy)]
struct CompLinearState {
    end_prog_x: f64,
    end_prog_y: f64,
    end_off_x: f64,
    end_off_y: f64,
    dir_x: f64,
    dir_y: f64,
    mode: i32,
    radius: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AxisOffset {
    pub axis_id: u32,
    pub value: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct WorkOffset {
    pub label: String,
    pub offsets: Vec<AxisOffset>,
}

#[derive(Serialize)]
pub struct MachineState {
    pub axes: Vec<Axis>,
    pub channels: Vec<ChannelStatus>,
    pub estop: bool,
    pub active_wcs: usize,
    pub work_offsets: Vec<WorkOffset>,
    pub is_homing: bool,
}

#[wasm_bindgen]
pub struct MachineBrain {
    axes: Vec<Axis>,
    channels: Vec<Channel>,
    estop: bool,
    work_offsets: Vec<WorkOffset>,
    active_wcs: usize,
    is_homing: bool,
    homing_sequence: Vec<u32>,
    homing_index: usize,
    homing_feed: f64,
    homing_rapid: bool,
}

fn default_work_offsets() -> Vec<WorkOffset> {
    vec![
        WorkOffset { label: "G54".to_string(), offsets: Vec::new() },
        WorkOffset { label: "G55".to_string(), offsets: Vec::new() },
        WorkOffset { label: "G56".to_string(), offsets: Vec::new() },
        WorkOffset { label: "G57".to_string(), offsets: Vec::new() },
        WorkOffset { label: "G58".to_string(), offsets: Vec::new() },
        WorkOffset { label: "G59".to_string(), offsets: Vec::new() },
        WorkOffset { label: "G153".to_string(), offsets: Vec::new() },
    ]
}

fn normalize_rotary_target(value: f64) -> f64 {
    let mut wrapped = value % 360.0;
    if wrapped > 180.0 {
        wrapped -= 360.0;
    } else if wrapped <= -180.0 {
        wrapped += 360.0;
    }
    wrapped
}

const RAPID_LINEAR_MIN_MM_MIN: f64 = 50_000.0; // 50 m/min
const RAPID_LINEAR_MAX_MM_MIN: f64 = 80_000.0; // 80 m/min
const RAPID_ROTARY_MIN_DEG_MIN: f64 = 6_000.0;
const RAPID_ROTARY_MAX_DEG_MIN: f64 = 30_000.0;

fn axis_rapid_feed(ax: &Axis) -> f64 {
    match ax.axis_type {
        AxisType::Linear => (ax.accel.max(1.0) * 30.0).clamp(RAPID_LINEAR_MIN_MM_MIN, RAPID_LINEAR_MAX_MM_MIN),
        AxisType::Rotary => (ax.accel.max(1.0) * 20.0).clamp(RAPID_ROTARY_MIN_DEG_MIN, RAPID_ROTARY_MAX_DEG_MIN),
    }
}


fn arc_center_matches(
    sx: f64,
    sy: f64,
    ex: f64,
    ey: f64,
    cx: f64,
    cy: f64,
    cw: bool,
    want_large: bool,
) -> bool {
    let a0 = (sy - cy).atan2(sx - cx);
    let a1 = (ey - cy).atan2(ex - cx);
    let mut da = a1 - a0;
    if cw {
        if da >= 0.0 { da -= std::f64::consts::TAU; }
    } else {
        if da <= 0.0 { da += std::f64::consts::TAU; }
    }
    let sweep = da.abs();
    if want_large {
        sweep >= std::f64::consts::PI - 1e-9
    } else {
        sweep <= std::f64::consts::PI + 1e-9
    }
}

fn build_short_arc_points(
    cx: f64,
    cy: f64,
    from: (f64, f64),
    to: (f64, f64),
    radius: f64,
) -> Vec<(f64, f64)> {
    if radius <= 1e-9 {
        return vec![to];
    }
    let a0 = (from.1 - cy).atan2(from.0 - cx);
    let a1 = (to.1 - cy).atan2(to.0 - cx);
    let mut da = a1 - a0;
    while da <= -std::f64::consts::PI {
        da += std::f64::consts::TAU;
    }
    while da > std::f64::consts::PI {
        da -= std::f64::consts::TAU;
    }
    let sweep = da.abs();
    if sweep <= 1e-6 {
        return vec![to];
    }
    let n = ((radius * sweep) / 1.2).ceil().clamp(4.0, 48.0) as usize;
    let mut out = Vec::with_capacity(n);
    for k in 1..=n {
        let t = k as f64 / n as f64;
        let a = a0 + da * t;
        out.push((cx + radius * a.cos(), cy + radius * a.sin()));
    }
    out
}

fn line_intersection_2d(
    p1: (f64, f64),
    d1: (f64, f64),
    p2: (f64, f64),
    d2: (f64, f64),
) -> Option<(f64, f64)> {
    let cross = d1.0 * d2.1 - d1.1 * d2.0;
    if cross.abs() <= 1e-9 {
        return None;
    }
    let qmp = (p2.0 - p1.0, p2.1 - p1.1);
    let t = (qmp.0 * d2.1 - qmp.1 * d2.0) / cross;
    Some((p1.0 + t * d1.0, p1.1 + t * d1.1))
}

#[wasm_bindgen]
impl MachineBrain {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        console_log!("MachineBrain v6: Zero Control Ready");
        Self {
            axes: Vec::new(),
            channels: Vec::new(),
            estop: false,
            active_wcs: 0,
            is_homing: false,
            work_offsets: default_work_offsets(),
            homing_sequence: Vec::new(),
            homing_index: 0,
            homing_feed: 300.0,
            homing_rapid: false,
        }
    }

    pub fn clear_config(&mut self) {
        self.axes.clear();
        self.channels.clear();
        self.work_offsets = default_work_offsets();
        self.active_wcs = 0;
        self.is_homing = false;
        self.homing_sequence.clear();
        self.homing_index = 0;
        self.homing_feed = 300.0;
        self.homing_rapid = false;
    }

    fn start_homing_sequence(&mut self, mut order: Vec<u32>, rapid: bool, feed: f64) {
        if self.estop {
            return;
        }
        order.retain(|id| (*id as usize) < self.axes.len());
        order.dedup();
        if order.is_empty() {
            self.is_homing = false;
            self.homing_sequence.clear();
            self.homing_index = 0;
            return;
        }
        self.is_homing = true;
        self.homing_sequence = order;
        self.homing_index = 0;
        self.homing_rapid = rapid;
        self.homing_feed = feed.max(1.0);
    }

    fn machine_target_with_limits(&self, axis_id: u32, machine_target: f64) -> f64 {
        let Some(ax) = self.axes.get(axis_id as usize) else {
            return machine_target;
        };
        match ax.axis_type {
            AxisType::Rotary => normalize_rotary_target(machine_target),
            AxisType::Linear => machine_target.clamp(ax.min_range, ax.max_range),
        }
    }

    fn channel_rapid_feed(&self, channel_index: usize) -> f64 {
        let Some(chan) = self.channels.get(channel_index) else {
            return RAPID_LINEAR_MAX_MM_MIN;
        };
        let mut rapid = RAPID_LINEAR_MAX_MM_MIN;
        let mut any = false;
        for m in &chan.axis_map {
            if let Some(ax) = self.axes.get(m.axis_id as usize) {
                rapid = rapid.min(axis_rapid_feed(ax));
                any = true;
            }
        }
        if any { rapid } else { RAPID_LINEAR_MAX_MM_MIN }
    }

    pub fn add_axis(&mut self, name: String, kind: AxisType, min: f64, max: f64) -> u32 {
        let id = self.axes.len() as u32;

        for wcs in self.work_offsets.iter_mut() {
            wcs.offsets.push(AxisOffset { axis_id: id, value: 0.0 });
        }
        self.axes.push(Axis {
            id, physical_name: name, position: 0.0, target: 0.0, velocity: 0.0, accel: 0.0,
            axis_type: kind, min_range: min, max_range: max, homed: false, invert: false, machine_zero: 0.0,
        });
        id
    }

    pub fn add_channel(&mut self, id: u32, mappings: JsValue) {
        let axis_map: Vec<ChannelAxisMap> = serde_wasm_bindgen::from_value(mappings).unwrap_or_default();
        self.channels.push(Channel {
            id, axis_map, feed_rate: 1000.0, is_running: false,
            paused: false, program: Vec::new(), pc: 0, active_pc: -1,
            current_motion: 0,
            abs_mode: true,
            units_mm: true,
            plane: 17,
            exact_stop: false,
            cutter_comp: 40,
            tool_radius: 4.0,
            length_comp_active: false,
            tool_length: 50.0,
            active_tool: 0,
            active_d: 0,
            active_h: 0,
            spindle_rpm: 0.0,
            spindle_mode: 5,
            coolant_on: false,
            feed_override: 1.0,
            single_block: false,
            step_once: false,
            pause_pending: false,
            tool_table: HashMap::from([
                (0, ToolTableEntry { radius: 4.0, length: 50.0 }),
                (1, ToolTableEntry { radius: 4.0, length: 50.0 }),
            ]),
            comp_linear_prev: None,
            comp_entry_pending: false,
            pending: VecDeque::new(),
            programmed_work: HashMap::new(),
        });
    }

    // ── Program control ────────────────────────────────────────────────────

    pub fn load_program(&mut self, channel_index: usize, code: String) {
        if let Some(chan) = self.channels.get_mut(channel_index) {
            chan.program = code.lines().map(|l| l.trim().to_uppercase()).collect();
            chan.pc = 0;
            chan.active_pc = -1;
            chan.is_running = true;
            chan.paused = false;
            chan.current_motion = 0;
            chan.step_once = false;
            chan.pause_pending = false;
            chan.programmed_work.clear();
            chan.comp_linear_prev = None;
            chan.comp_entry_pending = false;
        }
    }

    pub fn toggle_pause(&mut self, channel_index: usize) {
        if let Some(chan) = self.channels.get_mut(channel_index) {
            chan.paused = !chan.paused;
        }
    }

    pub fn reset_program(&mut self, channel_index: usize) {
        if let Some(chan) = self.channels.get_mut(channel_index) {
            chan.pc = 0;
            chan.active_pc = -1;
            chan.is_running = false;
            chan.paused = false;
            chan.step_once = false;
            chan.pause_pending = false;
            chan.programmed_work.clear();
            chan.comp_linear_prev = None;
            chan.comp_entry_pending = false;
        }
    }

    pub fn set_feed_override(&mut self, channel_index: usize, ratio: f64) {
        if let Some(chan) = self.channels.get_mut(channel_index) {
            chan.feed_override = ratio.clamp(0.0, 2.0);
        }
    }

    pub fn set_single_block(&mut self, channel_index: usize, enabled: bool) {
        if let Some(chan) = self.channels.get_mut(channel_index) {
            chan.single_block = enabled;
        }
    }

    pub fn step_once(&mut self, channel_index: usize) {
        if let Some(chan) = self.channels.get_mut(channel_index) {
            if !chan.is_running { return; }
            chan.step_once = true;
            chan.paused = false;
        }
    }

    pub fn jump_blocks(&mut self, channel_index: usize, delta: i32) {
        let Some(chan) = self.channels.get_mut(channel_index) else { return; };
        if chan.program.is_empty() { return; }

        let len = chan.program.len() as i32;
        let mut next_pc = chan.pc as i32 + delta;
        if next_pc < 0 { next_pc = 0; }
        if next_pc > len { next_pc = len; }

        chan.pc = next_pc as usize;
        chan.active_pc = if chan.pc == 0 { -1 } else { (chan.pc - 1) as i32 };
        chan.pending.clear();
        chan.pause_pending = false;
        chan.step_once = false;
        chan.paused = true;
        chan.is_running = true;

        for m in &chan.axis_map {
            if let Some(ax) = self.axes.get_mut(m.axis_id as usize) {
                ax.velocity = 0.0;
            }
        }
    }

    pub fn set_tool_length(&mut self, channel_index: usize, length: f64) {
        if let Some(chan) = self.channels.get_mut(channel_index) {
            chan.tool_length = length;
            chan.active_h = 0;
            let entry = chan.tool_table.entry(0).or_insert(ToolTableEntry { radius: 0.0, length: 0.0 });
            entry.length = length;
        }
    }

    pub fn set_tool_length_comp(&mut self, channel_index: usize, active: bool) {
        if let Some(chan) = self.channels.get_mut(channel_index) {
            chan.length_comp_active = active;
        }
    }

    pub fn set_tool_radius(&mut self, channel_index: usize, radius: f64) {
        if let Some(chan) = self.channels.get_mut(channel_index) {
            chan.tool_radius = radius.abs();
            chan.active_d = 0;
            let entry = chan.tool_table.entry(0).or_insert(ToolTableEntry { radius: 0.0, length: 0.0 });
            entry.radius = chan.tool_radius;
        }
    }

    pub fn set_tool_table_entry(&mut self, channel_index: usize, slot: i32, length: f64, radius: f64) {
        if let Some(chan) = self.channels.get_mut(channel_index) {
            let idx = slot.max(0);
            let radius_abs = radius.abs();
            chan.tool_table.insert(idx, ToolTableEntry { radius: radius_abs, length });
            if chan.active_tool == idx {
                chan.tool_length = length;
                chan.tool_radius = radius_abs;
            }
        }
    }

    pub fn set_active_tool(&mut self, channel_index: usize, slot: i32) {
        if let Some(chan) = self.channels.get_mut(channel_index) {
            let idx = slot.max(0);
            chan.active_tool = idx;
            chan.active_d = 0;
            chan.active_h = 0;
            if idx == 0 {
                chan.tool_length = 0.0;
                chan.tool_radius = 0.0;
                chan.length_comp_active = false;
                chan.cutter_comp = 40;
                chan.tool_table.insert(0, ToolTableEntry { radius: 0.0, length: 0.0 });
            } else if let Some(entry) = chan.tool_table.get(&idx).copied() {
                chan.tool_length = entry.length;
                chan.tool_radius = entry.radius.abs();
                // Keep D0/H0 in sync with currently loaded tool.
                chan.tool_table.insert(0, entry);
            }
        }
    }

    pub fn set_cutter_comp(&mut self, channel_index: usize, mode: i32) {
        if let Some(chan) = self.channels.get_mut(channel_index) {
            chan.cutter_comp = match mode {
                41 => 41,
                42 => 42,
                _ => 40,
            };
            chan.comp_linear_prev = None;
            chan.comp_entry_pending = false;
        }
    }

    fn resolve_d_radius(&self, channel_index: usize, d_raw: f64, d_scaled: f64) -> f64 {
        let Some(chan) = self.channels.get(channel_index) else {
            return d_scaled.abs();
        };

        let idx = d_raw.round() as i32;
        if (d_raw - idx as f64).abs() <= 1e-9 {
            if let Some(entry) = chan.tool_table.get(&idx) {
                return entry.radius.abs();
            }
        }
        d_scaled.abs()
    }

    fn resolve_table_slot_index(raw: f64) -> Option<i32> {
        let idx = raw.round() as i32;
        if (raw - idx as f64).abs() <= 1e-9 {
            Some(idx.max(0))
        } else {
            None
        }
    }

    fn resolve_h_length(&self, channel_index: usize, h_raw: f64, h_scaled: f64) -> f64 {
        let Some(chan) = self.channels.get(channel_index) else {
            return h_scaled;
        };

        let idx = h_raw.round() as i32;
        if (h_raw - idx as f64).abs() <= 1e-9 {
            if let Some(entry) = chan.tool_table.get(&idx) {
                return entry.length;
            }
        }
        h_scaled
    }

    pub fn move_to(&mut self, axis_id: u32, target: f64) {
        if let Some(ax) = self.axes.get_mut(axis_id as usize) {
            ax.target = match ax.axis_type {
                AxisType::Rotary => normalize_rotary_target(target),
                AxisType::Linear => target.clamp(ax.min_range, ax.max_range),
            };
        }
    }

    // ── Homing ────────────────────────────────────────────────────────────

    pub fn home_all(&mut self) {
        if self.estop { return; }
        let mut order: Vec<u32> = Vec::with_capacity(self.axes.len());
        if let Some(z) = self.axes.iter().find(|ax| ax.physical_name.eq_ignore_ascii_case("Z")) {
            order.push(z.id);
        }
        for ax in self.axes.iter() {
            if !order.iter().any(|id| *id == ax.id) {
                order.push(ax.id);
            }
        }
        for ax in self.axes.iter_mut() {
            ax.target = 0.0;
            ax.homed = false;
        }
        self.start_homing_sequence(order, false, 300.0);
        console_log!("Homing all axes");
    }

    pub fn home_all_ordered(&mut self, primary_axis_id: i32, rapid: bool, feed: f64) {
        if self.estop { return; }
        let mut order: Vec<u32> = Vec::with_capacity(self.axes.len());
        if primary_axis_id >= 0 {
            let pid = primary_axis_id as u32;
            if (pid as usize) < self.axes.len() {
                order.push(pid);
            }
        }
        for ax in self.axes.iter() {
            if !order.iter().any(|id| *id == ax.id) {
                order.push(ax.id);
            }
        }
        for ax in self.axes.iter_mut() {
            ax.target = 0.0;
            ax.homed = false;
        }
        self.start_homing_sequence(order, rapid, feed);
        console_log!(
            "Homing ordered: primary={}, rapid={}, feed={}",
            primary_axis_id,
            rapid,
            feed
        );
    }

    pub fn home_axis(&mut self, axis_id: u32) {
        if self.estop { return; }
        if (axis_id as usize) >= self.axes.len() { return; }
        if let Some(ax) = self.axes.get_mut(axis_id as usize) {
            ax.target = 0.0;
            ax.homed = false;
        }
        self.start_homing_sequence(vec![axis_id], false, 300.0);
    }

    // ── Jogging ───────────────────────────────────────────────────────────

    pub fn jog_axis(&mut self, axis_id: u32, delta: f64) {
        if self.estop { return; }
        if let Some(ax) = self.axes.get_mut(axis_id as usize) {
            let next = ax.target + delta;
            ax.target = match ax.axis_type {
                AxisType::Rotary => normalize_rotary_target(next),
                AxisType::Linear => next.clamp(ax.min_range, ax.max_range),
            };
        }
    }

    pub fn jog_axis_feed(&mut self, axis_id: u32, delta: f64, feed: f64) {
        if self.estop { return; }
        if let Some(ax) = self.axes.get_mut(axis_id as usize) {
            let next = ax.target + delta;
            ax.target = match ax.axis_type {
                AxisType::Rotary => normalize_rotary_target(next),
                AxisType::Linear => next.clamp(ax.min_range, ax.max_range),
            };
            ax.velocity = ax.velocity.min(feed.max(1.0));
        }
        let f = feed.max(1.0);
        for chan in self.channels.iter_mut() {
            if chan.axis_map.iter().any(|m| m.axis_id == axis_id) && !chan.is_running {
                chan.feed_rate = f;
            }
        }
    }

    pub fn jog_axis_rapid(&mut self, axis_id: u32, delta: f64) {
        let rapid_feed = self
            .axes
            .get(axis_id as usize)
            .map(axis_rapid_feed)
            .unwrap_or(RAPID_LINEAR_MAX_MM_MIN);
        self.jog_axis_feed(axis_id, delta, rapid_feed);
        if let Some(ax) = self.axes.get_mut(axis_id as usize) {
            ax.velocity = ax.velocity.max(rapid_feed);
        }
        for chan in self.channels.iter_mut() {
            if chan.axis_map.iter().any(|m| m.axis_id == axis_id) && !chan.is_running {
                chan.current_motion = 0;
                chan.feed_rate = rapid_feed;
            }
        }
    }

    // ── Work Zeros ────────────────────────────────────────────────────────

    pub fn set_work_zero(&mut self, axis_id: u32, wcs_index: usize, machine_pos: f64) {
        if let Some(wcs) = self.work_offsets.get_mut(wcs_index) {
            if let Some(off) = wcs.offsets.iter_mut().find(|o| o.axis_id == axis_id) {
                off.value = machine_pos;
                console_log!("WCS {} axis {} offset = {}", wcs.label, axis_id, machine_pos);
            }
        }
    }

    pub fn set_active_wcs(&mut self, wcs_index: usize) {
        if wcs_index < self.work_offsets.len() {
            self.active_wcs = wcs_index;
        }
    }

    pub fn add_work_offset(&mut self, label: String) -> usize {
        let mut offsets = Vec::with_capacity(self.axes.len());
        for ax in &self.axes {
            offsets.push(AxisOffset { axis_id: ax.id, value: 0.0 });
        }
        self.work_offsets.push(WorkOffset { label, offsets });
        self.work_offsets.len() - 1
    }

    // ── E-Stop ────────────────────────────────────────────────────────────

    pub fn set_estop(&mut self, s: bool) {
        self.estop = s;
        if s {
            for chan in self.channels.iter_mut() {
                chan.is_running = false;
                chan.paused = false;
                chan.pending.clear();
                chan.pause_pending = false;
                chan.step_once = false;
                chan.active_pc = -1;
            }
            for ax in self.axes.iter_mut() {
                ax.target = ax.position;
                ax.velocity = 0.0;
            }
        }
    }

    // ── Tick ──────────────────────────────────────────────────────────────

    pub fn tick(&mut self, dt_ms: f64) {
    if self.estop || dt_ms <= 0.0 { return; }
    let dt_sec = dt_ms / 1000.0;

    // ── Helper closure: trapezoidal move for one axis ──────────────────
    // Returns true if still moving
    fn move_axis(ax: &mut Axis, feed: f64, dt_sec: f64, stop_at_target: bool) -> bool {
        let diff = ax.target - ax.position;
        let dist = diff.abs();
        if dist <= 0.0005 {
            ax.position = ax.target;
            if stop_at_target {
                ax.velocity = 0.0;
            }
            return false;
        }

        let dir = diff.signum();
        let feed = feed.max(1.0);
        let accel = ax.accel.max(1.0);
        let mut vel = ax.velocity.max(0.0);

        let stop_dist = (vel * vel) / (2.0 * accel);

        if stop_at_target && dist <= stop_dist + 0.01 {
            vel = (vel - accel * dt_sec).max(0.0);
        } else if vel < feed {
            vel = (vel + accel * dt_sec).min(feed);
        }

        let mut step = (vel / 60.0) * dt_sec;
        if step <= 0.000001 {
            if dist <= 0.05 {
                ax.position = ax.target;
                ax.velocity = 0.0;
                return false;
            }
            vel = (feed * 0.02).max(1.0).min(feed);
            step = (vel / 60.0) * dt_sec;
        }

        if step >= dist {
            ax.position = ax.target;
            if stop_at_target {
                ax.velocity = 0.0;
            } else {
                ax.velocity = vel;
            }
            false
        } else {
            ax.position += step * dir;
            ax.velocity = vel;
            true
        }
    }

    // ── Homing: takes priority over programs ───────────────────────────
    if self.is_homing {
        if self.homing_index >= self.homing_sequence.len() {
            self.is_homing = false;
            self.homing_sequence.clear();
            self.homing_index = 0;
            console_log!("Homing complete");
            return;
        }
        let axis_id = self.homing_sequence[self.homing_index];
        if let Some(ax) = self.axes.get_mut(axis_id as usize) {
            let home_feed = if self.homing_rapid {
                axis_rapid_feed(ax)
            } else {
                self.homing_feed.max(1.0)
            };
            let still_moving = move_axis(ax, home_feed, dt_sec, true);
            if !still_moving {
                ax.homed = true;
                ax.position = 0.0;
                ax.target = 0.0;
                ax.velocity = 0.0;
                self.homing_index += 1;
                if self.homing_index >= self.homing_sequence.len() {
                    self.is_homing = false;
                    self.homing_sequence.clear();
                    self.homing_index = 0;
                    console_log!("Homing complete");
                }
            }
        } else {
            self.homing_index += 1;
        }
        return;
    }

    // ── Channel program execution ──────────────────────────────────────
    for c_idx in 0..self.channels.len() {
        if self.channels[c_idx].paused { continue; }

        let motion = self.channels[c_idx].current_motion;
        let feed = if motion == 0 {
            self.channel_rapid_feed(c_idx)
        } else {
            self.channels[c_idx].feed_rate * self.channels[c_idx].feed_override
        };
        // 0% feed override behaves like feed-hold for feed moves (G1/G2/G3).
        // Rapid (G0) is still allowed.
        if feed <= 0.0 && motion != 0 {
            for m in &self.channels[c_idx].axis_map {
                if let Some(ax) = self.axes.get_mut(m.axis_id as usize) {
                    ax.velocity = 0.0;
                }
            }
            continue;
        }
        let pending_active = !self.channels[c_idx].pending.is_empty();
        let has_future = pending_active
            || (self.channels[c_idx].is_running && self.channels[c_idx].pc < self.channels[c_idx].program.len());
        // Continuous mode: only force exact stop when requested (G61), at final stop,
        // or when a pause/single-block stop is pending.
        let stop_at_target = self.channels[c_idx].exact_stop
            || !has_future
            || self.channels[c_idx].pause_pending;
        let mut still_moving = false;

        for m in &self.channels[c_idx].axis_map {
            if let Some(ax) = self.axes.get_mut(m.axis_id as usize) {
                if move_axis(ax, feed, dt_sec, stop_at_target) {
                    still_moving = true;
                }
            }
        }

        if self.channels[c_idx].is_running && !still_moving {
            if self.channels[c_idx].pause_pending && self.channels[c_idx].pending.is_empty() {
                self.channels[c_idx].paused = true;
                self.channels[c_idx].pause_pending = false;
                self.channels[c_idx].step_once = false;
                continue;
            }

            // If we have pending arc segments, execute them before advancing the program counter.
            if let Some(next) = self.channels[c_idx].pending.pop_front() {
                for (axis_id, tgt) in next {
                    if let Some(ax) = self.axes.get_mut(axis_id as usize) {
                        ax.target = match ax.axis_type {
                            AxisType::Rotary => normalize_rotary_target(tgt),
                            AxisType::Linear => tgt.clamp(ax.min_range, ax.max_range),
                        };
                    }
                }
                continue;
            }

            let current_pc = self.channels[c_idx].pc;
            if current_pc < self.channels[c_idx].program.len() {
                let line = self.channels[c_idx].program[current_pc].clone();
                self.channels[c_idx].active_pc = current_pc as i32;
                self.parse_line(c_idx, &line);
                if self.channels[c_idx].single_block || self.channels[c_idx].step_once {
                    self.channels[c_idx].pause_pending = true;
                }
                self.channels[c_idx].pc += 1;
            } else {
                self.channels[c_idx].is_running = false;
                self.channels[c_idx].active_pc = -1;
            }
        }
    }
}


fn wcs_offset(&self, axis_id: u32) -> f64 {
    self.work_offsets
        .get(self.active_wcs)
        .and_then(|w| w.offsets.iter().find(|o| o.axis_id == axis_id))
        .map(|o| o.value)
        .unwrap_or(0.0)
}

fn machine_to_work(&self, axis_id: u32, machine_pos: f64) -> f64 {
    // CNC convention: WORK = MACHINE - OFFSET
    machine_pos - self.wcs_offset(axis_id)
}

fn work_to_machine(&self, axis_id: u32, work_pos: f64) -> f64 {
    // CNC convention: MACHINE = WORK + OFFSET
    work_pos + self.wcs_offset(axis_id)
}

fn peek_next_comp_linear_xy(
    &self,
    c_idx: usize,
    start_x: f64,
    start_y: f64,
    current_motion: i32,
    abs_mode: bool,
    units_mm: bool,
    cutter_comp_mode: i32,
) -> Option<(f64, f64, i32)> {
    let chan = self.channels.get(c_idx)?;
    if !chan.is_running {
        return None;
    }
    let next_pc = chan.pc + 1;
    let line = chan.program.get(next_pc)?;
    let bytes = line.as_bytes();
    let mut i = 0;
    let mut g_words: Vec<i32> = Vec::new();
    let mut x: Option<f64> = None;
    let mut y: Option<f64> = None;
    let mut x_set = false;
    let mut y_set = false;
    let mut units_mm_word = units_mm;

    while i < bytes.len() {
        let b = bytes[i];
        if b.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if b == b';' {
            break;
        }
        if b == b'(' {
            while i < bytes.len() && bytes[i] != b')' {
                i += 1;
            }
            if i < bytes.len() && bytes[i] == b')' {
                i += 1;
            }
            continue;
        }

        let c = b.to_ascii_uppercase();
        if c == b'G' {
            i += 1;
            let (val, len) = self.parse_float_bytes(&bytes[i..]);
            if let Some(v) = val {
                let g = v.round() as i32;
                g_words.push(g);
                if g == 20 {
                    units_mm_word = false;
                } else if g == 21 {
                    units_mm_word = true;
                }
            }
            i += len;
            continue;
        }
        if c == b'X' {
            i += 1;
            let (val, len) = self.parse_float_bytes(&bytes[i..]);
            let unit = if units_mm_word { 1.0 } else { 25.4 };
            x = val.map(|v| v * unit);
            if x.is_some() {
                x_set = true;
            }
            i += len;
            continue;
        }
        if c == b'Y' {
            i += 1;
            let (val, len) = self.parse_float_bytes(&bytes[i..]);
            let unit = if units_mm_word { 1.0 } else { 25.4 };
            y = val.map(|v| v * unit);
            if y.is_some() {
                y_set = true;
            }
            i += len;
            continue;
        }
        i += 1;
    }

    let mut abs = abs_mode;
    let mut motion = current_motion;
    let mut comp = cutter_comp_mode;
    for g in g_words {
        match g {
            90 => abs = true,
            91 => abs = false,
            0 | 1 | 2 | 3 => motion = g,
            40 => comp = 40,
            41 => comp = 41,
            42 => comp = 42,
            _ => {}
        }
    }
    if motion != 1 || !matches!(comp, 41 | 42) || (!x_set && !y_set) {
        return None;
    }

    let ex = if x_set {
        if abs {
            x.unwrap_or(start_x)
        } else {
            start_x + x.unwrap_or(0.0)
        }
    } else {
        start_x
    };
    let ey = if y_set {
        if abs {
            y.unwrap_or(start_y)
        } else {
            start_y + y.unwrap_or(0.0)
        }
    } else {
        start_y
    };
    Some((ex, ey, comp))
}

fn parse_line(&mut self, c_idx: usize, line: &str) {
    let cutter_comp_before = self.channels[c_idx].cutter_comp;
    let comp_entry_pending_before = self.channels[c_idx].comp_entry_pending;
    let mut known_labels: Vec<(String, u32)> = self.channels[c_idx]
        .axis_map
        .iter()
        .map(|m| (m.display_label.to_uppercase(), m.axis_id))
        .collect();
    known_labels.sort_by(|a, b| b.0.len().cmp(&a.0.len()));

    // Helper: label -> axis_id
    let axis_id_for = |lbl: &str, known: &Vec<(String, u32)>| -> Option<u32> {
        for (l, id) in known {
            if l == lbl {
                return Some(*id);
            }
        }
        None
    };

    // Current positions in programmed WORK coordinates for mapped axes.
    // - Prefer cached programmed geometry position (uncompensated)
    // - Fallback to machine position converted to work coords
    // - If G43 is active, decompensate Z on fallback so tool-length doesn't stack
    let z_axis_for_comp = axis_id_for("Z", &known_labels);
    let length_comp_active_now = self.channels[c_idx].length_comp_active;
    let tool_length_now = self.channels[c_idx].tool_length;
    let mut cur_work: std::collections::HashMap<u32, f64> = std::collections::HashMap::new();
    for (_, axis_id) in &known_labels {
        if let Some(wp) = self.channels[c_idx].programmed_work.get(axis_id).copied() {
            cur_work.insert(*axis_id, wp);
        } else if let Some(ax) = self.axes.get(*axis_id as usize) {
            let mut w = self.machine_to_work(*axis_id, ax.position);
            if length_comp_active_now && Some(*axis_id) == z_axis_for_comp {
                w -= tool_length_now;
            }
            cur_work.insert(*axis_id, w);
        }
    }

    let bytes = line.as_bytes();
    let mut i = 0;

    // Parsed words
    let mut g_words: Vec<i32> = Vec::new();
    let mut m_words: Vec<i32> = Vec::new();
    let mut f_word: Option<f64> = None;
    let mut s_word: Option<f64> = None;
    let mut t_word: Option<i32> = None;
    let mut x: Option<f64> = None;
    let mut y: Option<f64> = None;
    let mut z: Option<f64> = None;
    let mut x_set = false;
    let mut y_set = false;
    let mut z_set = false;
    let mut i_off: Option<f64> = None;
    let mut j_off: Option<f64> = None;
    let mut r_word: Option<f64> = None;
    let mut d_word: Option<f64> = None;
    let mut d_word_raw: Option<f64> = None;
    let mut h_word: Option<f64> = None;
    let mut h_word_raw: Option<f64> = None;
    let mut units_mm_word = self.channels[c_idx].units_mm;

    while i < bytes.len() {
        if bytes[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }

        // Comments: ( ... ) and ; to end-of-line
        if bytes[i] == b';' {
            break;
        }
        if bytes[i] == b'(' {
            while i < bytes.len() && bytes[i] != b')' {
                i += 1;
            }
            if i < bytes.len() && bytes[i] == b')' {
                i += 1;
            }
            continue;
        }

        let c = bytes[i].to_ascii_uppercase();

        // Prefer explicit multi-character axis labels (e.g. Z3) before
        // handling single-letter XYZ words, to avoid token ambiguity.
        if let Some((label, axis_id)) = known_labels
            .iter()
            .find(|(label, _)| label.len() > 1 && bytes[i..].starts_with(label.as_bytes()))
        {
            i += label.len();
            let (val, len) = self.parse_float_bytes(&bytes[i..]);
            if let Some(v) = val {
                let unit = if units_mm_word { 1.0 } else { 25.4 };
                let v_scaled = v * unit;
                let v_work = if self.channels[c_idx].abs_mode {
                    v_scaled
                } else {
                    cur_work.get(axis_id).copied().unwrap_or(0.0) + v_scaled
                };
                let tgt = self.machine_target_with_limits(*axis_id, self.work_to_machine(*axis_id, v_work));
                if let Some(ax) = self.axes.get_mut(*axis_id as usize) {
                    ax.target = tgt;
                }
            }
            i += len;
            continue;
        }

        // --- G words ---
        if c == b'G' {
            i += 1;
            let (val, len) = self.parse_float_bytes(&bytes[i..]);
            if let Some(v) = val {
                let g = v.round() as i32;
                g_words.push(g);
                if g == 20 {
                    units_mm_word = false;
                } else if g == 21 {
                    units_mm_word = true;
                }
            }
            i += len;
            continue;
        }

        // --- M words ---
        if c == b'M' {
            i += 1;
            let (val, len) = self.parse_float_bytes(&bytes[i..]);
            if let Some(v) = val {
                m_words.push(v.round() as i32);
            }
            i += len;
            continue;
        }

        // --- Feed ---
        if c == b'F' {
            i += 1;
            let (val, len) = self.parse_float_bytes(&bytes[i..]);
            let unit = if units_mm_word { 1.0 } else { 25.4 };
            f_word = val.map(|v| v * unit);
            i += len;
            continue;
        }

        // --- Spindle speed ---
        if c == b'S' {
            i += 1;
            let (val, len) = self.parse_float_bytes(&bytes[i..]);
            s_word = val;
            i += len;
            continue;
        }

        // --- Tool select ---
        if c == b'T' {
            i += 1;
            let (val, len) = self.parse_float_bytes(&bytes[i..]);
            if let Some(v) = val {
                t_word = Some(v.round() as i32);
            }
            i += len;
            continue;
        }

        // --- Arc params ---
        if c == b'I' {
            i += 1;
            let (val, len) = self.parse_float_bytes(&bytes[i..]);
            let unit = if units_mm_word { 1.0 } else { 25.4 };
            i_off = val.map(|v| v * unit);
            i += len;
            continue;
        }
        if c == b'J' {
            i += 1;
            let (val, len) = self.parse_float_bytes(&bytes[i..]);
            let unit = if units_mm_word { 1.0 } else { 25.4 };
            j_off = val.map(|v| v * unit);
            i += len;
            continue;
        }
        if c == b'R' {
            i += 1;
            let (val, len) = self.parse_float_bytes(&bytes[i..]);
            let unit = if units_mm_word { 1.0 } else { 25.4 };
            r_word = val.map(|v| v * unit);
            i += len;
            continue;
        }
        if c == b'D' {
            i += 1;
            let (val, len) = self.parse_float_bytes(&bytes[i..]);
            let unit = if units_mm_word { 1.0 } else { 25.4 };
            d_word_raw = val;
            d_word = val.map(|v| v * unit);
            i += len;
            continue;
        }
        if c == b'H' {
            i += 1;
            let (val, len) = self.parse_float_bytes(&bytes[i..]);
            let unit = if units_mm_word { 1.0 } else { 25.4 };
            h_word_raw = val;
            h_word = val.map(|v| v * unit);
            i += len;
            continue;
        }

        // --- Common XYZ axis words ---
        if c == b'X' {
            i += 1;
            let (val, len) = self.parse_float_bytes(&bytes[i..]);
            let unit = if units_mm_word { 1.0 } else { 25.4 };
            x = val.map(|v| v * unit);
            if x.is_some() { x_set = true; }
            i += len;
            continue;
        }
        if c == b'Y' {
            i += 1;
            let (val, len) = self.parse_float_bytes(&bytes[i..]);
            let unit = if units_mm_word { 1.0 } else { 25.4 };
            y = val.map(|v| v * unit);
            if y.is_some() { y_set = true; }
            i += len;
            continue;
        }
        if c == b'Z' {
            i += 1;
            let (val, len) = self.parse_float_bytes(&bytes[i..]);
            let unit = if units_mm_word { 1.0 } else { 25.4 };
            z = val.map(|v| v * unit);
            if z.is_some() { z_set = true; }
            i += len;
            continue;
        }

        // Fallback: try matching longer labels (e.g., A, B, C, etc.)
        let mut matched = false;
        for (label, axis_id) in &known_labels {
            if bytes[i..].starts_with(label.as_bytes()) {
                i += label.len();
                let (val, len) = self.parse_float_bytes(&bytes[i..]);
                if let Some(v) = val {
                    let unit = if units_mm_word { 1.0 } else { 25.4 };
                    let v_scaled = v * unit;
                    // Interpret as WORK coordinate.
                    let v_work = if self.channels[c_idx].abs_mode {
                        v_scaled
                    } else {
                        cur_work.get(axis_id).copied().unwrap_or(0.0) + v_scaled
                    };
                    // Compute target without holding a mutable borrow of `self.axes`.
                    let tgt = self.machine_target_with_limits(*axis_id, self.work_to_machine(*axis_id, v_work));
                    if let Some(ax) = self.axes.get_mut(*axis_id as usize) {
                        ax.target = tgt;
                    }
                }
                i += len;
                matched = true;
                break;
            }
        }
        if !matched {
            i += 1;
        }
    }

    // Apply feed
    if let Some(f) = f_word {
        self.channels[c_idx].feed_rate = f;
    }
    if let Some(s) = s_word {
        self.channels[c_idx].spindle_rpm = s.max(0.0);
    }
    if let Some(t) = t_word {
        let idx = t.max(0);
        self.channels[c_idx].active_tool = idx;
        self.channels[c_idx].active_d = 0;
        self.channels[c_idx].active_h = 0;
        if idx == 0 {
            // T0 = unload tool (no length/radius comp baseline from loaded tool).
            self.channels[c_idx].tool_length = 0.0;
            self.channels[c_idx].tool_radius = 0.0;
            self.channels[c_idx].length_comp_active = false;
            self.channels[c_idx].cutter_comp = 40;
            self.channels[c_idx]
                .tool_table
                .insert(0, ToolTableEntry { radius: 0.0, length: 0.0 });
        } else {
            let table_entry = self.channels[c_idx].tool_table.get(&idx).copied();
            if let Some(entry) = table_entry {
                self.channels[c_idx].tool_length = entry.length;
                self.channels[c_idx].tool_radius = entry.radius.abs();
                // Keep D0/H0 mirrored to active tool for practical table workflows.
                self.channels[c_idx].tool_table.insert(0, entry);
            }
        }
    }

    let has_axis_motion_words = x_set || y_set || z_set;
    let has_xy_motion_words = x_set || y_set;
    let g40_requested = g_words.iter().any(|g| *g == 40);
    let g41_requested = g_words.iter().any(|g| *g == 41);
    let g42_requested = g_words.iter().any(|g| *g == 42);

    // Apply modal G-codes (G90/G91/G17 and WCS selection)
    for g in &g_words {
        match *g {
            90 => self.channels[c_idx].abs_mode = true,
            91 => self.channels[c_idx].abs_mode = false,
            20 => self.channels[c_idx].units_mm = false,
            21 => self.channels[c_idx].units_mm = true,
            17 => self.channels[c_idx].plane = 17,
            61 => self.channels[c_idx].exact_stop = true,
            64 => self.channels[c_idx].exact_stop = false,
            54 => self.active_wcs = 0,
            55 => self.active_wcs = 1,
            56 => self.active_wcs = 2,
            57 => self.active_wcs = 3,
            58 => self.active_wcs = 4,
            59 => self.active_wcs = 5,
            153 => self.active_wcs = 6,
            40 => {
                self.channels[c_idx].cutter_comp = 40;
                self.channels[c_idx].comp_linear_prev = None;
                self.channels[c_idx].comp_entry_pending = false;
            }
            41 => {
                self.channels[c_idx].cutter_comp = 41;
                if let Some(d) = d_word {
                    let d_raw = d_word_raw.unwrap_or(d);
                    self.channels[c_idx].active_d = Self::resolve_table_slot_index(d_raw).unwrap_or(0);
                    self.channels[c_idx].tool_radius = self.resolve_d_radius(c_idx, d_raw, d);
                }
            }
            42 => {
                self.channels[c_idx].cutter_comp = 42;
                if let Some(d) = d_word {
                    let d_raw = d_word_raw.unwrap_or(d);
                    self.channels[c_idx].active_d = Self::resolve_table_slot_index(d_raw).unwrap_or(0);
                    self.channels[c_idx].tool_radius = self.resolve_d_radius(c_idx, d_raw, d);
                }
            }
            43 => {
                self.channels[c_idx].length_comp_active = true;
                if let Some(h) = h_word {
                    let h_raw = h_word_raw.unwrap_or(h);
                    self.channels[c_idx].active_h = Self::resolve_table_slot_index(h_raw).unwrap_or(0);
                    self.channels[c_idx].tool_length = self.resolve_h_length(c_idx, h_raw, h);
                }
            }
            49 => self.channels[c_idx].length_comp_active = false,
            _ => {}
        }
    }

    // Apply modal M-codes.
    for m in &m_words {
        match *m {
            3 => self.channels[c_idx].spindle_mode = 3,
            4 => self.channels[c_idx].spindle_mode = 4,
            5 => self.channels[c_idx].spindle_mode = 5,
            8 => self.channels[c_idx].coolant_on = true,
            9 => self.channels[c_idx].coolant_on = false,
            _ => {}
        }
    }

    if g40_requested {
        self.channels[c_idx].comp_entry_pending = false;
    } else if g41_requested || g42_requested {
        // Arming comp without XY move should defer entry until first XY feed block.
        // If comp was already pending, a repeated G41/G42 on the engage line must
        // not clear that pending state.
        self.channels[c_idx].comp_entry_pending = !has_xy_motion_words || comp_entry_pending_before;
    }

    // Allow standalone D/H words to update active registers.
    if let Some(d) = d_word {
        let d_raw = d_word_raw.unwrap_or(d);
        self.channels[c_idx].active_d = Self::resolve_table_slot_index(d_raw).unwrap_or(0);
        self.channels[c_idx].tool_radius = self.resolve_d_radius(c_idx, d_raw, d);
    }
    if let Some(h) = h_word {
        let h_raw = h_word_raw.unwrap_or(h);
        self.channels[c_idx].active_h = Self::resolve_table_slot_index(h_raw).unwrap_or(0);
        self.channels[c_idx].tool_length = self.resolve_h_length(c_idx, h_raw, h);
    }

    // Motion mode: prefer the last motion G-word on the line, otherwise keep modal motion.
    let mut motion: Option<i32> = None;
    for g in &g_words {
        if matches!(*g, 0 | 1 | 2 | 3) {
            motion = Some(*g);
        }
    }
    let motion = motion.unwrap_or(self.channels[c_idx].current_motion);
    if !matches!(motion, 0 | 1 | 2 | 3) {
        return;
    }
    self.channels[c_idx].current_motion = motion;
    let cutter_comp_just_enabled = matches!(cutter_comp_before, 40)
        && matches!(self.channels[c_idx].cutter_comp, 41 | 42);
    // Controller-style behavior:
    // If G40 appears on a block with axis motion, execute this block with the
    // previous compensation side, then leave compensation canceled for next block.
    let g40_cancel_on_motion = g40_requested && has_axis_motion_words && matches!(cutter_comp_before, 41 | 42);

    // Resolve axis ids for X/Y/Z.
    let x_id = axis_id_for("X", &known_labels);
    let y_id = axis_id_for("Y", &known_labels);
    let z_id = axis_id_for("Z", &known_labels);
    let cutter_comp = if g40_cancel_on_motion {
        cutter_comp_before
    } else {
        self.channels[c_idx].cutter_comp
    };
    let comp_entry_pending_now = self.channels[c_idx].comp_entry_pending;
    let tool_radius = self.channels[c_idx].tool_radius.max(0.0);
    let length_comp_active = self.channels[c_idx].length_comp_active;
    let tool_length = self.channels[c_idx].tool_length;

    // Build programmed end point in WORK coordinates (uncompensated).
    let mut end_work = cur_work.clone();
    if let (Some(id), Some(v)) = (x_id, x) {
        let newv = if self.channels[c_idx].abs_mode {
            v
        } else {
            end_work.get(&id).copied().unwrap_or(0.0) + v
        };
        end_work.insert(id, newv);
    }
    if let (Some(id), Some(v)) = (y_id, y) {
        let newv = if self.channels[c_idx].abs_mode {
            v
        } else {
            end_work.get(&id).copied().unwrap_or(0.0) + v
        };
        end_work.insert(id, newv);
    }
    if let (Some(id), Some(v)) = (z_id, z) {
        let newv = if self.channels[c_idx].abs_mode {
            v
        } else {
            end_work.get(&id).copied().unwrap_or(0.0) + v
        };
        end_work.insert(id, newv);
    }

    // Motion end point starts from programmed geometry, then compensation may adjust.
    let mut end_work_motion = end_work.clone();
    let mut corner_transition_work: Vec<(f64, f64)> = Vec::new();
    let mut comp_linear_next: Option<CompLinearState> = None;

    // Cutter compensation: offset XY endpoint normal to move direction.
    if matches!(motion, 1 | 2 | 3) && tool_radius > 0.0 && matches!(cutter_comp, 41 | 42) {
        if let (Some(xid), Some(yid)) = (x_id, y_id) {
            let sx = cur_work.get(&xid).copied().unwrap_or(0.0);
            let sy = cur_work.get(&yid).copied().unwrap_or(0.0);
            let ex = end_work.get(&xid).copied().unwrap_or(sx);
            let ey = end_work.get(&yid).copied().unwrap_or(sy);
            let dx = ex - sx;
            let dy = ey - sy;
            let len = (dx * dx + dy * dy).sqrt();
            if len > 1e-9 {
                let dir_x = dx / len;
                let dir_y = dy / len;
                let left_nx = -dir_y;
                let left_ny = dir_x;
                let sign = if cutter_comp == 41 { 1.0 } else { -1.0 };
                let start_off = (sx + left_nx * tool_radius * sign, sy + left_ny * tool_radius * sign);
                let mut end_off = (ex + left_nx * tool_radius * sign, ey + left_ny * tool_radius * sign);
                // Look-ahead trim for inside corners:
                // truncate current compensated endpoint to the offset-line intersection
                // with the next compensated linear block (controller-like behavior).
                if motion == 1 {
                    if let Some((nex, ney, next_comp)) = self.peek_next_comp_linear_xy(
                        c_idx,
                        ex,
                        ey,
                        self.channels[c_idx].current_motion,
                        self.channels[c_idx].abs_mode,
                        self.channels[c_idx].units_mm,
                        self.channels[c_idx].cutter_comp,
                    ) {
                        if next_comp == cutter_comp {
                            let ndx = nex - ex;
                            let ndy = ney - ey;
                            let nlen = (ndx * ndx + ndy * ndy).sqrt();
                            if nlen > 1e-9 {
                                let n_dir_x = ndx / nlen;
                                let n_dir_y = ndy / nlen;
                                let n_left_nx = -n_dir_y;
                                let n_left_ny = n_dir_x;
                                let next_start_off = (
                                    ex + n_left_nx * tool_radius * sign,
                                    ey + n_left_ny * tool_radius * sign,
                                );
                                let turn_cross = dir_x * n_dir_y - dir_y * n_dir_x;
                                let side_sign = if cutter_comp == 41 { 1.0 } else { -1.0 };
                                let outside_corner = side_sign * turn_cross < -1e-6;
                                if !outside_corner {
                                    if let Some(join) = line_intersection_2d(
                                        start_off,
                                        (dir_x, dir_y),
                                        next_start_off,
                                        (n_dir_x, n_dir_y),
                                    ) {
                                        let t_curr = (join.0 - start_off.0) * dir_x + (join.1 - start_off.1) * dir_y;
                                        if t_curr >= -1e-6 && t_curr <= len + 1e-6 {
                                            end_off = join;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                end_work_motion.insert(xid, end_off.0);
                end_work_motion.insert(yid, end_off.1);

                if motion == 1 {
                    let force_entry = (cutter_comp_just_enabled && (x_set ^ y_set)) || comp_entry_pending_now;
                    if force_entry {
                        let entry_gap = ((start_off.0 - sx).powi(2) + (start_off.1 - sy).powi(2)).sqrt();
                        if entry_gap > 1e-6 {
                            corner_transition_work.push(start_off);
                        }
                    } else if let Some(prev) = self.channels[c_idx].comp_linear_prev {
                        if prev.mode == cutter_comp
                            && (prev.radius - tool_radius).abs() <= 1e-6
                            && (prev.end_prog_x - sx).abs() <= 1e-4
                            && (prev.end_prog_y - sy).abs() <= 1e-4
                        {
                            let corner_gap = ((prev.end_off_x - start_off.0).powi(2) + (prev.end_off_y - start_off.1).powi(2)).sqrt();
                            if corner_gap > 1e-5 {
                                let turn_cross = prev.dir_x * dir_y - prev.dir_y * dir_x;
                                let side_sign = if cutter_comp == 41 { 1.0 } else { -1.0 };
                                let outside_corner = side_sign * turn_cross < -1e-6;
                                if outside_corner {
                                    corner_transition_work = build_short_arc_points(
                                        sx,
                                        sy,
                                        (prev.end_off_x, prev.end_off_y),
                                        start_off,
                                        tool_radius,
                                    );
                                } else {
                                    // Inside corners should keep each programmed segment direction.
                                    // Join by intersection of the two compensated lines (miter join),
                                    // not by direct shortcut between tangent points.
                                    if let Some(join) = line_intersection_2d(
                                        (prev.end_off_x, prev.end_off_y),
                                        (prev.dir_x, prev.dir_y),
                                        start_off,
                                        (dir_x, dir_y),
                                    ) {
                                        corner_transition_work.push(join);
                                    } else {
                                        corner_transition_work.push(start_off);
                                    }
                                }
                            }
                        }
                    }

                    comp_linear_next = Some(CompLinearState {
                        end_prog_x: ex,
                        end_prog_y: ey,
                        end_off_x: end_off.0,
                        end_off_y: end_off.1,
                        dir_x,
                        dir_y,
                        mode: cutter_comp,
                        radius: tool_radius,
                    });
                }
            }
        }
    }

    // Linear moves
    if motion == 0 || motion == 1 {
        let rapid_feed = if motion == 0 {
            self.channel_rapid_feed(c_idx)
        } else {
            0.0
        };
        let mut x_move = x_set;
        let mut y_move = y_set;
        let z_move = z_set;

        // Under active G41/G42, compensation may require moving the orthogonal axis
        // even if that axis word is omitted in the block.
        if motion == 1 && tool_radius > 0.0 && matches!(cutter_comp, 41 | 42) {
            if let Some(xid) = x_id {
                let s = cur_work.get(&xid).copied().unwrap_or(0.0);
                let e = end_work_motion.get(&xid).copied().unwrap_or(s);
                if (e - s).abs() > 1e-9 {
                    x_move = true;
                }
            }
            if let Some(yid) = y_id {
                let s = cur_work.get(&yid).copied().unwrap_or(0.0);
                let e = end_work_motion.get(&yid).copied().unwrap_or(s);
                if (e - s).abs() > 1e-9 {
                    y_move = true;
                }
            }
        }

        let mut final_seg: Vec<(u32, f64)> = Vec::new();
        for (id_opt, do_move) in [(x_id, x_move), (y_id, y_move), (z_id, z_move)] {
            let Some(id) = id_opt else { continue; };
            if !do_move {
                continue;
            }
            if let Some(vw) = end_work_motion.get(&id).copied() {
                let mut vw_comp = vw;
                if Some(id) == z_id && length_comp_active {
                    vw_comp += tool_length;
                }
                let tgt = self.machine_target_with_limits(id, self.work_to_machine(id, vw_comp));
                final_seg.push((id, tgt));
            }
        }

        // Insert smooth corner transition for compensated linear paths.
        if motion == 1 && !corner_transition_work.is_empty() {
            if let (Some(xid), Some(yid)) = (x_id, y_id) {
                for (idx, (wx, wy)) in corner_transition_work.iter().enumerate() {
                    let x_tgt = self.machine_target_with_limits(xid, self.work_to_machine(xid, *wx));
                    let y_tgt = self.machine_target_with_limits(yid, self.work_to_machine(yid, *wy));

                    if idx == 0 {
                        if let Some(ax) = self.axes.get_mut(xid as usize) {
                            ax.target = x_tgt;
                        }
                        if let Some(ax) = self.axes.get_mut(yid as usize) {
                            ax.target = y_tgt;
                        }
                    } else {
                        self.channels[c_idx].pending.push_back(vec![(xid, x_tgt), (yid, y_tgt)]);
                    }
                }

                if !final_seg.is_empty() {
                    self.channels[c_idx].pending.push_back(final_seg);
                }

                for id in [x_id, y_id, z_id].into_iter().flatten() {
                    if let Some(vw) = end_work.get(&id).copied() {
                        self.channels[c_idx].programmed_work.insert(id, vw);
                    }
                }
                if comp_linear_next.is_some() {
                    self.channels[c_idx].comp_entry_pending = false;
                }
                if g40_cancel_on_motion {
                    self.channels[c_idx].comp_linear_prev = None;
                } else {
                    self.channels[c_idx].comp_linear_prev = comp_linear_next;
                }
                return;
            }
        }

        for (id, tgt) in final_seg {
            if let Some(ax) = self.axes.get_mut(id as usize) {
                ax.target = tgt;
                if motion == 0 {
                    ax.velocity = ax.velocity.max(rapid_feed);
                }
            }
        }
        // Update programmed position cache from uncompensated target geometry.
        for id in [x_id, y_id, z_id].into_iter().flatten() {
            if let Some(vw) = end_work.get(&id).copied() {
                self.channels[c_idx].programmed_work.insert(id, vw);
            }
        }
        if motion == 1 {
            if comp_linear_next.is_some() {
                self.channels[c_idx].comp_entry_pending = false;
                if g40_cancel_on_motion {
                    self.channels[c_idx].comp_linear_prev = None;
                } else {
                    self.channels[c_idx].comp_linear_prev = comp_linear_next;
                }
            } else if x_set || y_set || !matches!(cutter_comp, 41 | 42) || tool_radius <= 0.0 {
                if !matches!(cutter_comp, 41 | 42) || tool_radius <= 0.0 {
                    self.channels[c_idx].comp_entry_pending = false;
                }
                self.channels[c_idx].comp_linear_prev = None;
            }
        } else {
            if !matches!(cutter_comp, 41 | 42) || tool_radius <= 0.0 {
                self.channels[c_idx].comp_entry_pending = false;
            }
            self.channels[c_idx].comp_linear_prev = None;
        }
        return;
    }

    // Arc moves: only XY plane supported (G17)
    if self.channels[c_idx].plane != 17 {
        self.channels[c_idx].comp_linear_prev = None;
        return;
    }
    self.channels[c_idx].comp_linear_prev = None;
    let (Some(xid), Some(yid)) = (x_id, y_id) else { return; };

    let sx = cur_work.get(&xid).copied().unwrap_or(0.0);
    let sy = cur_work.get(&yid).copied().unwrap_or(0.0);
    let ex = end_work.get(&xid).copied().unwrap_or(sx);
    let ey = end_work.get(&yid).copied().unwrap_or(sy);

    let cw = motion == 2; // G2 = CW, G3 = CCW

    // Determine center in WORK coords.
    let (cx, cy) = if i_off.is_some() || j_off.is_some() {
        (sx + i_off.unwrap_or(0.0), sy + j_off.unwrap_or(0.0))
    } else if let Some(r) = r_word {
        let dx = ex - sx;
        let dy = ey - sy;
        let chord = (dx * dx + dy * dy).sqrt();
        if chord <= 1e-9 {
            return;
        }
        let r_abs = r.abs();
        if chord > 2.0 * r_abs + 1e-9 {
            return;
        }

        let mx = (sx + ex) * 0.5;
        let my = (sy + ey) * 0.5;
        let h = (r_abs * r_abs - (chord * 0.5) * (chord * 0.5)).sqrt();

        // unit perpendicular to chord
        let ux = -dy / chord;
        let uy = dx / chord;

        let c1 = (mx + ux * h, my + uy * h);
        let c2 = (mx - ux * h, my - uy * h);

        // R < 0 means “long way” (>180°)
        let want_large = r < 0.0;

        if arc_center_matches(sx, sy, ex, ey, c1.0, c1.1, cw, want_large) {
            c1
        } else {
            c2
        }
    } else {
        return;
    };

    let r = ((sx - cx).powi(2) + (sy - cy).powi(2)).sqrt();
    if r <= 1e-9 {
        return;
    }

    let a0 = (sy - cy).atan2(sx - cx);
    let a1 = (ey - cy).atan2(ex - cx);
    let mut da = a1 - a0;

    // Correct direction:
    // - CCW: positive rotation (da in (0, +2π])
    // - CW:  negative rotation (da in [-2π, 0))
    if cw {
        if da >= 0.0 {
            da -= std::f64::consts::TAU;
        }
    } else {
        if da <= 0.0 {
            da += std::f64::consts::TAU;
        }
    }

    let arc_len = r * da.abs();
    // Segment count from chord error tolerance (mm) with safe clamps.
    let tol = 0.005_f64;
    let n_by_tol = if r <= tol {
        3.0
    } else {
        let step_ang = 2.0 * (1.0 - (tol / r)).clamp(-1.0, 1.0).acos();
        if step_ang.is_finite() && step_ang > 1e-6 {
            (da.abs() / step_ang).ceil()
        } else {
            3.0
        }
    };
    let n_by_len = (arc_len / 1.5_f64).ceil();
    let n = n_by_tol.max(n_by_len).clamp(24.0, 1440.0) as usize;

    // Helical Z if present
    let sz = z_id.and_then(|id| cur_work.get(&id).copied());
    let ez = z_id.and_then(|id| end_work.get(&id).copied());

    for k in 1..=n {
        let t = k as f64 / n as f64;
        let ang = a0 + da * t;
        let mut px = cx + r * ang.cos();
        let mut py = cy + r * ang.sin();

        if tool_radius > 0.0 && matches!(cutter_comp, 41 | 42) {
            let dir = da.signum(); // +1 CCW, -1 CW
            let tx = -ang.sin() * dir;
            let ty = ang.cos() * dir;
            let left_nx = -ty;
            let left_ny = tx;
            let sign = if cutter_comp == 41 { 1.0 } else { -1.0 };
            px += left_nx * tool_radius * sign;
            py += left_ny * tool_radius * sign;
        }

        let mut seg: Vec<(u32, f64)> = Vec::new();
        seg.push((xid, self.work_to_machine(xid, px)));
        seg.push((yid, self.work_to_machine(yid, py)));

        if let (Some(zid), Some(szv), Some(ezv)) = (z_id, sz, ez) {
            let mut pz = szv + (ezv - szv) * t;
            if length_comp_active {
                pz += tool_length;
            }
            seg.push((zid, self.work_to_machine(zid, pz)));
        }

        self.channels[c_idx].pending.push_back(seg);
    }

    // Update programmed position cache from uncompensated geometric end point.
    for id in [x_id, y_id, z_id].into_iter().flatten() {
        if let Some(vw) = end_work.get(&id).copied() {
            self.channels[c_idx].programmed_work.insert(id, vw);
        }
    }
}

fn parse_float_bytes(&self, bytes: &[u8]) -> (Option<f64>, usize) {
    if bytes.is_empty() {
        return (None, 0);
    }

    let mut i = 0usize;
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    if i >= bytes.len() {
        return (None, i);
    }

    let mut len = i;
    if bytes[len] == b'+' || bytes[len] == b'-' {
        len += 1;
    }

    let mut has_digit = false;
    let mut has_dot = false;
    while len < bytes.len() {
        let b = bytes[len];
        if b.is_ascii_digit() {
            has_digit = true;
            len += 1;
            continue;
        }
        if b == b'.' && !has_dot {
            has_dot = true;
            len += 1;
            continue;
        }
        break;
    }

    if !has_digit || len <= i {
        return (None, i);
    }

    let parsed = std::str::from_utf8(&bytes[i..len]).ok().and_then(|s| s.parse::<f64>().ok());
    (parsed, len)
}



    pub fn get_full_state(&self) -> JsValue {
        let state = MachineState {
            axes: self.axes.clone(),
            channels: self.channels.iter().map(|c| ChannelStatus {
                id: c.id,
                is_running: c.is_running,
                paused: c.paused,
                active_pc: c.active_pc,
                pc: c.pc,
                axis_map: c.axis_map.clone(),
                current_motion: c.current_motion,
                exact_stop: c.exact_stop,
                cutter_comp: c.cutter_comp,
                tool_radius: c.tool_radius,
                length_comp_active: c.length_comp_active,
                tool_length: c.tool_length,
                active_tool: c.active_tool,
                active_d: c.active_d,
                active_h: c.active_h,
                spindle_rpm: c.spindle_rpm,
                spindle_mode: c.spindle_mode,
                coolant_on: c.coolant_on,
                feed_rate: c.feed_rate,
                feed_override: c.feed_override,
                single_block: c.single_block,
                programmed_work: c.axis_map.iter().map(|m| AxisOffset {
                    axis_id: m.axis_id,
                    value: c.programmed_work.get(&m.axis_id).copied().unwrap_or(0.0),
                }).collect(),
            }).collect(),
            estop: self.estop,
            active_wcs: self.active_wcs,
            work_offsets: self.work_offsets.clone(),
            is_homing: self.is_homing,
        };
        serde_wasm_bindgen::to_value(&state).unwrap_or(JsValue::NULL)
    }

    pub fn set_axis_accel(&mut self, axis_id: u32, accel: f64) {
        if let Some(ax) = self.axes.get_mut(axis_id as usize) {
            ax.accel = accel;
        }
    }
    #[wasm_bindgen]
    pub fn set_axis_machine_zero(&mut self, axis_id: u32, machine_zero: f64) {
        if let Some(ax) = self.axes.get_mut(axis_id as usize) {
            ax.machine_zero = machine_zero;
        }
    }
    #[wasm_bindgen]
    pub fn set_axis_invert(&mut self, axis_id: u32, invert: bool) {
        if let Some(ax) = self.axes.get_mut(axis_id as usize) {
            ax.invert = invert;
        }
    }
}


