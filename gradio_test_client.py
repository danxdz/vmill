#!/usr/bin/env python3
"""
Client application for SPaCial AI OCR Service
Enhanced version with full feature support + Training Data Collection
"""

import os
import sys


import gradio as gr
import requests
from PIL import Image, ImageDraw, ImageFont
import io
import json
from typing import Tuple, Dict, Any, Optional, List
from datetime import datetime
import uuid

# Server options
SERVER_OPTIONS = {
    "HF Spaces (Cloud)": "https://cooldan-spacial-server-api.hf.space",
    "Local Server": "http://127.0.0.1:8081"
}

# Default API URL
API_URL = SERVER_OPTIONS["HF Spaces (Cloud)"]

# Global state for corrections
correction_state = {
    'original_zones': [],
    'corrected_zones': [],
    'image_data': None,
    'image_id': None,
    'api_url': None  # Track which server was used
}

def format_tolerance_info(tolerance_info: Optional[Dict]) -> str:
    """Format tolerance information for display - SIMPLIFIED"""
    if not tolerance_info:
        return ""
    
    tol_type = tolerance_info.get("tolerance_type", "")
    
    # Thread tolerance
    if tol_type == "thread":
        return f" [Thread: {tolerance_info.get('tolerance_class', '')}]"
    
    # Only show if there's actual tolerance data
    if tol_type in ["±", "+/-", "-only", "+only"]:
        return f" [{tol_type}]"
    
    return ""

def get_orientation_symbol(orientation: int) -> str:
    """Get symbol for text orientation"""
    if orientation == 0:
        return "→"  # Horizontal
    elif orientation == 90:
        return "↓"  # Vertical down
    elif orientation == 180:
        return "←"  # Horizontal reversed
    elif orientation == 270:
        return "↑"  # Vertical up
    elif orientation == 45:
        return "↘"  # Diagonal
    elif orientation == 135:
        return "↙"  # Diagonal
    elif orientation == 225:
        return "↖"  # Diagonal
    elif orientation == 315:
        return "↗"  # Diagonal
    else:
        return "⊙"  # Other

def get_bbox_color(zone: Dict) -> Tuple[int, int, int]:
    """Determine bbox color based on zone properties"""
    is_dimension = zone.get("is_dimension", False)
    orientation = zone.get("text_orientation", 0)
    
    if is_dimension:
        # Dimensions in blue shades
        if orientation in [45, 135, 225, 315]:
            return (0, 100, 255)  # Bright blue for diagonal dimensions
        else:
            return (0, 0, 255)  # Standard blue for dimensions
    else:
        # Regular text in green shades
        if orientation in [90, 270]:
            return (0, 200, 0)  # Bright green for vertical text
        elif orientation in [45, 135, 225, 315]:
            return (100, 255, 100)  # Light green for diagonal text
        else:
            return (0, 255, 0)  # Standard green for horizontal text

def initialize_correction_session(zones: List[Dict], pil_img: Image.Image, api_url: str = None):
    """Initialize a new correction session"""
    global correction_state
    
    # Generate unique image ID
    correction_state['image_id'] = str(uuid.uuid4())[:8]
    correction_state['original_zones'] = json.loads(json.dumps(zones))  # Deep copy
    correction_state['corrected_zones'] = json.loads(json.dumps(zones))  # Deep copy
    correction_state['api_url'] = api_url or API_URL  # Store which server was used
    
    # Save image as base64
    img_byte_arr = io.BytesIO()
    pil_img.save(img_byte_arr, format='PNG')
    img_byte_arr.seek(0)
    import base64
    correction_state['image_data'] = base64.b64encode(img_byte_arr.read()).decode('utf-8')

def build_zone_list_ui() -> str:
    """Build HTML for zone list with correction options"""
    global correction_state
    
    if not correction_state['corrected_zones']:
        return """
        <div style="font-family: Arial, sans-serif; padding: 20px; text-align: center; background: #f8f9fa; border-radius: 5px;">
            <p style="color: #666; margin: 0;">📋 No zones to display. Process an image first.</p>
        </div>
        """
    
    html = """
    <div style="font-family: Arial, sans-serif; background: white; padding: 10px; border-radius: 5px; border: 1px solid #ddd;">
        <h3 style="margin-top: 0; color: #333;">📝 Detected Zones</h3>
        <p style="color: #666; margin-bottom: 10px;">Total: <strong>{}</strong> zones</p>
        <div style="max-height: 500px; overflow-y: auto; padding-right: 5px;">
    """.format(len(correction_state['corrected_zones']))
    
    for i, zone in enumerate(correction_state['corrected_zones']):
        text = zone.get('text', '')
        confidence = zone.get('confidence', 0)
        is_dimension = zone.get('is_dimension', False)
        correction_type = zone.get('correction_type', 'none')
        tolerance_info = zone.get('tolerance_info')
        orientation = zone.get('text_orientation', 0)
        
        # Color and status based on correction type
        if correction_type == 'validated':
            bg_color = '#d4edda'
            border_color = '#28a745'
            status = '✅ Validated'
            status_color = '#155724'
        elif correction_type == 'text_fixed':
            bg_color = '#fff3cd'
            border_color = '#ffc107'
            status = '✏️ Text Corrected'
            status_color = '#856404'
        elif correction_type == 'deleted':
            bg_color = '#f8d7da'
            border_color = '#dc3545'
            status = '🗑️ Deleted'
            status_color = '#721c24'
        else:
            bg_color = '#ffffff'
            border_color = '#007bff' if is_dimension else '#28a745'
            status = '⏳ Pending'
            status_color = '#666'
        
        # Icon and type
        icon = "📐" if is_dimension else "📝"
        type_label = "Dimension" if is_dimension else "Text"
        
        # Orientation symbol
        orientation_symbol = get_orientation_symbol(orientation)
        
        # Tolerance display
        tolerance_str = ""
        if tolerance_info:
            tolerance_str = format_tolerance_info(tolerance_info)
        
        # Confidence bar
        conf_percent = int(confidence * 100)
        conf_color = '#28a745' if conf_percent >= 80 else ('#ffc107' if conf_percent >= 60 else '#dc3545')
        
        # Make clickable with onclick
        html += f"""
        <div onclick="document.querySelector('input[type=number]').value={i+1};" 
             style="background: {bg_color}; padding: 10px; margin: 5px 0; border-radius: 6px; 
                    border-left: 4px solid {border_color}; cursor: pointer; transition: all 0.2s;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1);"
             onmouseover="this.style.transform='translateX(5px)'; this.style.boxShadow='0 2px 8px rgba(0,0,0,0.15)';"
             onmouseout="this.style.transform='translateX(0)'; this.style.boxShadow='0 1px 3px rgba(0,0,0,0.1)';">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="flex: 1;">
                    <strong style="color: #333; font-size: 14px;">{icon} {i+1}. {text}</strong>
                    <div style="font-size: 11px; color: #666; margin-top: 3px;">
                        {orientation_symbol} {conf_percent}% | {status}
                    </div>
                </div>
            </div>
        </div>
        """
    
    html += """
        </div>
    </div>
    """
    return html

def update_zone_text(zone_index: int, new_text: str) -> str:
    """Update text for a specific zone"""
    global correction_state
    
    if 0 <= zone_index < len(correction_state['corrected_zones']):
        zone = correction_state['corrected_zones'][zone_index]
        old_text = zone.get('text', '')
        
        if old_text != new_text:
            zone['text'] = new_text
            zone['correction_type'] = 'text_fixed'
            zone['original_text'] = old_text
            return f"✅ Zone {zone_index+1} updated: '{old_text}' → '{new_text}'"
        else:
            return f"⚠️ No change detected"
    else:
        return f"❌ Invalid zone index: {zone_index}"

def validate_zone(zone_index: int) -> str:
    """Mark zone as validated (correct)"""
    global correction_state
    
    if 0 <= zone_index < len(correction_state['corrected_zones']):
        zone = correction_state['corrected_zones'][zone_index]
        zone['correction_type'] = 'validated'
        return f"✅ Zone {zone_index+1} marked as correct"
    else:
        return f"❌ Invalid zone index: {zone_index}"

def delete_zone(zone_index: int) -> str:
    """Mark zone as deleted"""
    global correction_state
    
    if 0 <= zone_index < len(correction_state['corrected_zones']):
        zone = correction_state['corrected_zones'][zone_index]
        zone['correction_type'] = 'deleted'
        return f"🗑️ Zone {zone_index+1} marked for deletion"
    else:
        return f"❌ Invalid zone index: {zone_index}"

def load_zone_coordinates(zone_index: int) -> Tuple[int, int, int, int, str]:
    """Load coordinates of a zone for editing"""
    global correction_state
    
    if 0 <= zone_index < len(correction_state['corrected_zones']):
        zone = correction_state['corrected_zones'][zone_index]
        bbox = zone.get('bbox', {})
        text = zone.get('text', '')
        
        x1 = bbox.get('x1', 0)
        y1 = bbox.get('y1', 0)
        x2 = bbox.get('x2', 0)
        y2 = bbox.get('y2', 0)
        
        return x1, y1, x2, y2, text
    else:
        return 0, 0, 0, 0, ""

def update_zone_coordinates(zone_index: int, x1: int, y1: int, x2: int, y2: int) -> str:
    """Update bounding box coordinates for a zone"""
    global correction_state
    
    if 0 <= zone_index < len(correction_state['corrected_zones']):
        zone = correction_state['corrected_zones'][zone_index]
        
        # Update bbox
        zone['bbox'] = {
            'x1': int(x1),
            'y1': int(y1),
            'x2': int(x2),
            'y2': int(y2),
            'width': int(x2 - x1),
            'height': int(y2 - y1)
        }
        
        # Update polygon to match new bbox (as rectangle)
        zone['polygon'] = [
            [x1, y1],
            [x2, y1],
            [x2, y2],
            [x1, y2]
        ]
        
        zone['correction_type'] = 'box_adjusted'
        
        return f"✅ Zone {zone_index+1} box updated to ({x1}, {y1}) → ({x2}, {y2})"
    else:
        return f"❌ Invalid zone index: {zone_index}"

def add_manual_zone(x1: int, y1: int, x2: int, y2: int, text: str) -> str:
    """Add a new zone manually"""
    global correction_state
    
    if not text.strip():
        return "❌ Please enter text for the new zone"
    
    if x1 >= x2 or y1 >= y2:
        return "❌ Invalid coordinates (x2 must be > x1, y2 must be > y1)"
    
    new_zone = {
        'id': f"manual_zone_{len(correction_state['corrected_zones']) + 1}",
        'text': text.strip(),
        'confidence': 1.0,  # Manual entry = 100% confidence
        'bbox': {
            'x1': int(x1),
            'y1': int(y1),
            'x2': int(x2),
            'y2': int(y2),
            'width': int(x2 - x1),
            'height': int(y2 - y1)
        },
        'polygon': [
            [x1, y1],
            [x2, y1],
            [x2, y2],
            [x1, y2]
        ],
        'text_orientation': 0,
        'is_dimension': False,
        'tolerance_info': None,
        'correction_type': 'manual_added'
    }
    
    correction_state['corrected_zones'].append(new_zone)
    
    return f"✅ Added new zone {len(correction_state['corrected_zones'])}: '{text}' at ({x1},{y1})→({x2},{y2})"

def export_corrections_json() -> Tuple[str, str]:
    """Export corrections as JSON file"""
    global correction_state
    
    if not correction_state['corrected_zones']:
        return None, "❌ No corrections to export"
    
    export_data = {
        'image_id': correction_state['image_id'],
        'timestamp': datetime.now().isoformat(),
        'original_zones': correction_state['original_zones'],
        'corrected_zones': correction_state['corrected_zones'],
        'statistics': {
            'total_zones': len(correction_state['corrected_zones']),
            'validated': sum(1 for z in correction_state['corrected_zones'] if z.get('correction_type') == 'validated'),
            'text_fixed': sum(1 for z in correction_state['corrected_zones'] if z.get('correction_type') == 'text_fixed'),
            'deleted': sum(1 for z in correction_state['corrected_zones'] if z.get('correction_type') == 'deleted'),
            'pending': sum(1 for z in correction_state['corrected_zones'] if z.get('correction_type', 'none') == 'none')
        }
    }
    
    # Save to temporary file
    filename = f"ocr_corrections_{correction_state['image_id']}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    
    try:
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(export_data, f, indent=2, ensure_ascii=False)
        
        return filename, f"✅ Exported corrections to {filename}"
    except Exception as e:
        return None, f"❌ Export failed: {str(e)}"

def send_to_telegram() -> str:
    """Send corrections to Telegram channel"""
    global correction_state
    
    if not correction_state['corrected_zones']:
        return "❌ No corrections to send"
    
    # Use the server that was used for OCR processing
    api_url = correction_state.get('api_url', API_URL)
    
    export_data = {
        'image_id': correction_state['image_id'],
        'timestamp': datetime.now().isoformat(),
        'user_id': 'gradio_client',
        'original_zones': correction_state['original_zones'],
        'corrected_zones': correction_state['corrected_zones'],
        'statistics': {
            'total_zones': len(correction_state['corrected_zones']),
            'validated': sum(1 for z in correction_state['corrected_zones'] if z.get('correction_type') == 'validated'),
            'text_fixed': sum(1 for z in correction_state['corrected_zones'] if z.get('correction_type') == 'text_fixed'),
            'deleted': sum(1 for z in correction_state['corrected_zones'] if z.get('correction_type') == 'deleted'),
            'pending': sum(1 for z in correction_state['corrected_zones'] if z.get('correction_type', 'none') == 'none')
        }
    }
    
    try:
        response = requests.post(
            f"{api_url}/corrections/submit",
            json=export_data,
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            return f"✅ Sent to Telegram!\n\nServer: {api_url}\nStatus: {result.get('status')}\nMessage: {result.get('message')}\nTotal zones: {result.get('total_zones')}"
        else:
            return f"❌ Server error ({api_url}): {response.status_code}\n{response.text}"
    except Exception as e:
        return f"❌ Failed to send to Telegram: {str(e)}"

def client_process_ocr(pil_img: Image.Image, mode: str = "fast", rotation: int = 0, api_url: str = None) -> Tuple[Image.Image, str, str, str]:
    """
    Function that sends the image to the FastAPI server for OCR processing.
    
    Args:
        pil_img: PIL Image object
        mode: OCR mode ('fast', 'accurate', or 'hardcore')
        rotation: Rotation angle in degrees (0, 90, 180, 270)
        api_url: Server URL (uses default if None)
    
    Returns:
        Tuple of (processed_image, extracted_text, statistics, zone_list_html)
    """
    
    if pil_img is None:
        return None, "Please upload an image first.", "", ""
    
    # Use provided API URL or default
    if api_url is None:
        api_url = API_URL
    
    # 1. Prepare the Image for POST Request
    img_byte_arr = io.BytesIO()
    # Save the image in JPEG format in memory
    pil_img.save(img_byte_arr, format='JPEG')
    img_byte_arr.seek(0)
    
    # Prepare data for submission (multipart/form-data)
    files = {'file': ('image.jpg', img_byte_arr, 'image/jpeg')}
    
    # The processing endpoint is "/ocr/process"
    endpoint_url = f"{api_url}/ocr/process"
    
    # Add query parameters
    params = {
        'mode': mode,
        'rotation': rotation
    }
    
    try:
        gr.Info(f"Sending image to OCR server (mode: {mode}, rotation: {rotation}°)...")
        
        # 2. Send HTTP POST Request
        response = requests.post(endpoint_url, files=files, params=params, timeout=60)
        
        # Check status code
        if response.status_code != 200:
            return pil_img, f"Server Error ({response.status_code}): {response.text}", "", ""

        # 3. Process JSON Response
        result_data = response.json()
        
        # Extract zones and metadata
        zones = result_data.get("zones", [])
        metadata = result_data.get("metadata", {})
        
        if not zones:
            return pil_img, "No text detected in image.", "Total zones: 0", ""
        
        # 4. Draw Bounding Boxes on Image
        draw_img = pil_img.copy()
        draw = ImageDraw.Draw(draw_img, 'RGBA')
        
        # Statistics counters
        stats = {
            'total': len(zones),
            'dimensions': 0,
            'with_tolerance': 0,
            'horizontal': 0,
            'vertical': 0,
            'diagonal': 0
        }
        
        full_text_output = []
        
        for i, zone in enumerate(zones):
            text = zone.get("text", "")
            confidence = zone.get("confidence", 0.0)
            bbox = zone.get("bbox", {})
            is_dimension = zone.get("is_dimension", False)
            tolerance_info = zone.get("tolerance_info")
            orientation = zone.get("text_orientation", 0)
            
            # Update statistics
            if is_dimension:
                stats['dimensions'] += 1
            if tolerance_info and tolerance_info.get("tolerance_type") != "none":
                stats['with_tolerance'] += 1
            if orientation in [0, 180]:
                stats['horizontal'] += 1
            elif orientation in [90, 270]:
                stats['vertical'] += 1
            elif orientation in [45, 135, 225, 315]:
                stats['diagonal'] += 1
            
            # Text formatting for output
            prefix = "📐" if is_dimension else "📝"
            orientation_symbol = get_orientation_symbol(orientation)
            tolerance_str = format_tolerance_info(tolerance_info)
            
            full_text_output.append(
                f"{i+1}. {prefix} {orientation_symbol} [{confidence:.2f}] {text}{tolerance_str}"
            )
            
            # Draw BBox with color coding (rotated to match text orientation)
            if bbox:
                # Get color based on zone type
                color = get_bbox_color(zone)
                
                # Get polygon points if available (supports rotation)
                polygon = zone.get('polygon', None)
                
                if polygon and len(polygon) >= 4:
                    # Draw rotated polygon (matches text orientation)
                    try:
                        # Convert polygon points to flat list for PIL
                        poly_points = [(int(p[0]), int(p[1])) for p in polygon]
                        
                        # Draw polygon outline (rotated to match text orientation)
                        draw.polygon(poly_points, outline=color, width=3)
                        
                        # Get top-left point for label
                        x1, y1 = int(polygon[0][0]), int(polygon[0][1])
                    except Exception as e:
                        # Fallback to rectangle if polygon fails
                        x1 = bbox.get("x1", 0)
                        y1 = bbox.get("y1", 0)
                        x2 = bbox.get("x2", 0)
                        y2 = bbox.get("y2", 0)
                        draw.rectangle([(x1, y1), (x2, y2)], outline=color, width=3)
                else:
                    # Fallback: draw simple rectangle
                    x1 = bbox.get("x1", 0)
                    y1 = bbox.get("y1", 0)
                    x2 = bbox.get("x2", 0)
                    y2 = bbox.get("y2", 0)
                    draw.rectangle([(x1, y1), (x2, y2)], outline=color, width=3)
                
                # Draw zone number label
                try:
                    # Try to use a font, fallback to default
                    font = ImageFont.truetype("arial.ttf", 14)
                except:
                    font = ImageFont.load_default()
                
                # Draw label background
                label = f"{i+1}"
                bbox_label = draw.textbbox((x1, y1 - 20), label, font=font)
                draw.rectangle(bbox_label, fill=(255, 255, 255, 200))
                draw.text((x1, y1 - 20), label, fill=color, font=font)
        
        gr.Info(f"Processing completed. Found {len(zones)} text zones.")
        
        # Initialize correction session with the API URL used
        initialize_correction_session(zones, pil_img, api_url)
        
        # Create statistics string
        stats_str = f"""📊 **Statistics:**
- Total zones: {stats['total']}
- Dimensions: {stats['dimensions']} 📐
- With tolerances: {stats['with_tolerance']} ±
- Horizontal: {stats['horizontal']} →
- Vertical: {stats['vertical']} ↓
- Diagonal: {stats['diagonal']} ↘

🎯 **Metadata:**
- Image ID: {correction_state['image_id']}
- Detected angle: {metadata.get('detected_angle', 0)}°
"""
        
        # Build zone list HTML
        zone_list_html = build_zone_list_ui()
        
        # Return the drawn image, text, stats, and zone list
        return draw_img, "\n".join(full_text_output), stats_str, zone_list_html

    except requests.exceptions.Timeout:
        return pil_img, f"Timeout Error: Server took too long to respond (>60s).", "", ""
    
    except requests.exceptions.ConnectionError:
        return pil_img, f"Connection Error: Cannot reach server at {api_url}\nMake sure the server is running.", "", ""

    except requests.exceptions.RequestException as e:
        return pil_img, f"API Connection Error: {str(e)}", "", ""

    except json.JSONDecodeError:
        return pil_img, f"Error: Invalid response (non-JSON) from server.\nResponse: {response.text[:200]}", "", ""

    except Exception as e:
        import traceback
        return pil_img, f"Unexpected error: {str(e)}\n\nTraceback:\n{traceback.format_exc()}", "", ""

def check_api_status(api_url: str = None) -> str:
    """Check if the API server is running and accessible."""
    if api_url is None:
        api_url = API_URL
    
    try:
        # Server uses "/" endpoint, not "/health"
        response = requests.get(f"{api_url}/", timeout=10)
        if response.status_code == 200:
            data = response.json()
            return f"""✅ **API Status: Running**

🔧 Service: {data.get('service', 'SPaCial AI OCR Service')}
📦 Version: {data.get('version', '1.0.0')}
🤖 OCR Initialized: {data.get('ocr_initialized', False)}
📡 Status: {data.get('status', 'running')}
🌐 URL: {api_url}
"""
        else:
            return f"❌ API Error: {response.status_code}\n{response.text}"
    except requests.exceptions.Timeout:
        return f"⏱️ Timeout: Server is not responding"
    except requests.exceptions.ConnectionError:
        return f"❌ Connection Error: Cannot reach {api_url}\n\nMake sure the server is deployed and running."
    except Exception as e:
        return f"❌ Error: {str(e)}"

# --- Gradio Interface ---

custom_css = """
.gradio-container {
    font-family: 'Arial', sans-serif;
}
.gr-button-primary {
    background: linear-gradient(90deg, #4CAF50, #45a049) !important;
    border: none !important;
}
.gr-button-secondary {
    background: linear-gradient(90deg, #2196F3, #1976D2) !important;
    border: none !important;
}
"""

with gr.Blocks(title="SPaCial OCR Client") as demo:
    gr.Markdown(
        """
        # 🖼️ SPaCial AI OCR Client (Enhanced)
        
        This interface connects to the **SPaCial AI OCR API** server for advanced dimension detection.
        
        ## 🎨 **Color Legend:**
        - 🟢 **Green**: Regular text (horizontal/vertical)
        - 💚 **Light Green**: Diagonal text (45°)
        - 🔵 **Blue**: Dimensions (horizontal/vertical)
        - 💙 **Bright Blue**: Diagonal dimensions (45°)
        
        ## 📐 **Orientation Symbols:**
        - → Horizontal | ↓ Vertical | ↘ Diagonal (45°) | ↙ Diagonal (135°)
        
        ## ⚙️ **OCR Modes:**
        - **Fast**: Quick detection for well-visible text
        - **Accurate**: Better for small or unclear text
        - **Hardcore**: Maximum detection (aggressive parameters)
        """
    )
    
    # Server Selection
    with gr.Row():
        server_selector = gr.Dropdown(
            choices=list(SERVER_OPTIONS.keys()),
            value="HF Spaces (Cloud)",
            label="🌐 Select Server",
            info="Choose between cloud (HF Spaces) or local server"
        )
    
    # API Status Check
    with gr.Row():
        with gr.Column(scale=2):
            status_btn = gr.Button("🔍 Check API Status", variant="secondary", size="sm")
        with gr.Column(scale=8):
            status_output = gr.Markdown(value="Click 'Check API Status' to verify server connection")
    
    gr.Markdown("---")
    
    with gr.Row():
        with gr.Column():
            image_input = gr.Image(
                type="pil", 
                label="📤 1. Upload Technical Drawing", 
                sources=["upload", "clipboard"], 
                interactive=True
            )
            
            # OCR Options
            gr.Markdown("### ⚙️ OCR Settings")
            with gr.Row():
                mode_dropdown = gr.Dropdown(
                    choices=["fast", "accurate", "hardcore"],
                    value="fast",
                    label="OCR Mode",
                    info="Hardcore mode uses aggressive detection parameters"
                )
                rotation_slider = gr.Slider(
                    minimum=0,
                    maximum=270,
                    value=0,
                    step=90,
                    label="Rotation (degrees)",
                    info="Pre-rotate image before OCR (0, 90, 180, 270)"
                )
            
            process_btn = gr.Button("🚀 Process Image with OCR", variant="primary", size="lg")
        
        with gr.Column():
            # Output columns
            image_output = gr.Image(
                type="pil", 
                label="📊 Result with Bounding Boxes", 
                interactive=False
            )
            
            stats_output = gr.Markdown(
                label="Statistics",
                value="Process an image to see statistics"
            )
    
    # Text output below (full width)
    gr.Markdown("### 📝 Extracted Text Details")
    text_output = gr.Textbox(
        label="Detected Text with Confidence, Orientation & Tolerances", 
        lines=10,
        interactive=False
    )
    
    gr.Markdown("---")
    
    # Training Data Collection Section
    gr.Markdown("## 🎓 Training Data Collection & Corrections")
    gr.Markdown("Review, correct, and export OCR results for model training")
    
    with gr.Row():
        with gr.Column():
            zone_list_html = gr.HTML(value="Process an image to see detected zones")
            
            # Correction controls
            gr.Markdown("### ✏️ Zone Corrections")
            gr.Markdown("💡 **Tip:** Enter zone number to edit, or use 'Add New Zone' to create one manually")
            
            with gr.Row():
                zone_index_input = gr.Number(
                    label="Zone Number (1-based)",
                    value=1,
                    precision=0,
                    minimum=1
                )
                correction_text_input = gr.Textbox(
                    label="Corrected Text",
                    placeholder="Enter correct text for the zone"
                )
            
            # Box coordinate editing
            gr.Markdown("### 📐 Adjust Box Coordinates")
            with gr.Row():
                bbox_x1 = gr.Number(label="X1 (left)", value=0, precision=0)
                bbox_y1 = gr.Number(label="Y1 (top)", value=0, precision=0)
                bbox_x2 = gr.Number(label="X2 (right)", value=0, precision=0)
                bbox_y2 = gr.Number(label="Y2 (bottom)", value=0, precision=0)
            
            with gr.Row():
                load_coords_btn = gr.Button("📥 Load Zone Coords", size="sm")
                update_coords_btn = gr.Button("💾 Update Box", variant="secondary", size="sm")
                add_new_zone_btn = gr.Button("➕ Add New Zone", variant="primary", size="sm")
            
            with gr.Row():
                validate_btn = gr.Button("✅ Mark as Correct", variant="secondary", size="sm")
                update_text_btn = gr.Button("✏️ Update Text", variant="secondary", size="sm")
                delete_btn = gr.Button("🗑️ Mark for Deletion", variant="secondary", size="sm")
            
            correction_result = gr.Textbox(
                label="Action Result",
                interactive=False,
                lines=2
            )
        
        with gr.Column():
            gr.Markdown("### 💾 Export & Share")
            
            # Export options
            with gr.Row():
                export_json_btn = gr.Button("📥 Download JSON", variant="primary")
                send_telegram_btn = gr.Button("📤 Send to Telegram", variant="primary")
            
            export_file = gr.File(label="Downloaded File")
            export_result = gr.Textbox(
                label="Export/Send Status",
                interactive=False,
                lines=5
            )
            
            gr.Markdown("""
            **Export Format:**
            - Original zones (before corrections)
            - Corrected zones (with changes tracked)
            - Statistics (validated, fixed, deleted counts)
            - Timestamp and unique image ID
            
            **Telegram Integration:**
            - Sends JSON data to training channel
            - Includes all corrections and metadata
            - Automatic notification to team
            """)
    
    gr.Markdown("---")
    
    # Examples
    gr.Markdown("### 📋 Quick Start Tips")
    gr.Markdown("""
    1. **Upload** a technical drawing or document image
    2. **Select** OCR mode (try 'hardcore' for difficult images)
    3. **Adjust** rotation if image is sideways
    4. **Click** 'Process Image with OCR'
    5. **View** results with color-coded bounding boxes
    
    **Note:** Dimensions (with Ø, ±, tolerances) are automatically highlighted in blue!
    """)
    
    # Event handlers
    # Helper function for status check with server
    def status_with_server(server_name):
        api_url = SERVER_OPTIONS[server_name]
        return check_api_status(api_url)
    
    status_btn.click(
        fn=status_with_server,
        inputs=[server_selector],
        outputs=status_output
    )
    
    # Helper function to pass server URL
    def process_with_server(img, mode, rotation, server_name):
        api_url = SERVER_OPTIONS[server_name]
        return client_process_ocr(img, mode, rotation, api_url)
    
    process_btn.click(
        fn=process_with_server,
        inputs=[image_input, mode_dropdown, rotation_slider, server_selector],
        outputs=[image_output, text_output, stats_output, zone_list_html]
    )
    
    # Correction handlers
    def handle_validate(zone_idx):
        # Convert from 1-based to 0-based
        result = validate_zone(int(zone_idx) - 1)
        updated_html = build_zone_list_ui()
        return result, updated_html
    
    def handle_update_text(zone_idx, new_text):
        # Convert from 1-based to 0-based
        result = update_zone_text(int(zone_idx) - 1, new_text)
        updated_html = build_zone_list_ui()
        return result, updated_html
    
    def handle_delete(zone_idx):
        # Convert from 1-based to 0-based
        result = delete_zone(int(zone_idx) - 1)
        updated_html = build_zone_list_ui()
        return result, updated_html
    
    validate_btn.click(
        fn=handle_validate,
        inputs=[zone_index_input],
        outputs=[correction_result, zone_list_html]
    )
    
    update_text_btn.click(
        fn=handle_update_text,
        inputs=[zone_index_input, correction_text_input],
        outputs=[correction_result, zone_list_html]
    )
    
    delete_btn.click(
        fn=handle_delete,
        inputs=[zone_index_input],
        outputs=[correction_result, zone_list_html]
    )
    
    # Box coordinate handlers
    def handle_load_coords(zone_idx):
        x1, y1, x2, y2, text = load_zone_coordinates(int(zone_idx) - 1)
        return x1, y1, x2, y2, text, f"📥 Loaded coordinates for zone {zone_idx}"
    
    def handle_update_coords(zone_idx, x1, y1, x2, y2):
        result = update_zone_coordinates(int(zone_idx) - 1, x1, y1, x2, y2)
        updated_html = build_zone_list_ui()
        return result, updated_html
    
    def handle_add_zone(x1, y1, x2, y2, text):
        result = add_manual_zone(x1, y1, x2, y2, text)
        updated_html = build_zone_list_ui()
        # Increment zone index to the new zone
        new_index = len(correction_state['corrected_zones'])
        return result, updated_html, new_index
    
    load_coords_btn.click(
        fn=handle_load_coords,
        inputs=[zone_index_input],
        outputs=[bbox_x1, bbox_y1, bbox_x2, bbox_y2, correction_text_input, correction_result]
    )
    
    update_coords_btn.click(
        fn=handle_update_coords,
        inputs=[zone_index_input, bbox_x1, bbox_y1, bbox_x2, bbox_y2],
        outputs=[correction_result, zone_list_html]
    )
    
    add_new_zone_btn.click(
        fn=handle_add_zone,
        inputs=[bbox_x1, bbox_y1, bbox_x2, bbox_y2, correction_text_input],
        outputs=[correction_result, zone_list_html, zone_index_input]
    )
    
    # Export handlers
    export_json_btn.click(
        fn=export_corrections_json,
        outputs=[export_file, export_result]
    )
    
    send_telegram_btn.click(
        fn=send_to_telegram,
        outputs=[export_result]
    )
    
    # Auto-check status on launch (MUST be inside Blocks context)
    # Load status on startup with default server
    def load_status_default():
        return check_api_status(SERVER_OPTIONS["HF Spaces (Cloud)"])
    
    demo.load(
        fn=load_status_default,
        outputs=status_output
    )

if __name__ == "__main__":
    # Launch the Gradio interface
    # For HF Spaces: Don't specify server_name or server_port
    # For local: Can specify server_name="0.0.0.0", server_port=7860
    import os
    is_hf_space = os.getenv("SPACE_ID") is not None
    
    if is_hf_space:
        # HF Spaces deployment
        demo.launch(
            show_error=True,
            css=custom_css
        )
    else:
        # Local deployment
        host = os.getenv("GRADIO_HOST", "127.0.0.1")
        port = int(os.getenv("GRADIO_PORT", "7860"))
        demo.launch(
            server_name=host,
            server_port=port,
            share=False,
            show_error=True,
            css=custom_css
        )
