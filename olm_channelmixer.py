import torch
from aiohttp import web
from server import PromptServer
import base64
from io import BytesIO
from PIL import Image


DEBUG_MODE = False
PREVIEW_RESOLUTION = 512


def debug_print(*args, **kwargs):
    if DEBUG_MODE:
        print(*args, **kwargs)


thumbnail_cache = {}


class OlmChannelMixer:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "version": ("STRING", {"default": "init"}),
                "image": ("IMAGE",),
                "red_in_red": ("FLOAT", {"default": 1.0, "min": -2.0, "max": 2.0, "step": 0.01}),
                "green_in_red": ("FLOAT", {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.01}),
                "blue_in_red": ("FLOAT", {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.01}),
                "red_in_green": ("FLOAT", {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.01}),
                "green_in_green": ("FLOAT", {"default": 1.0, "min": -2.0, "max": 2.0, "step": 0.01}),
                "blue_in_green": ("FLOAT", {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.01}),
                "red_in_blue": ("FLOAT", {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.01}),
                "green_in_blue": ("FLOAT", {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.01}),
                "blue_in_blue": ("FLOAT", {"default": 1.0, "min": -2.0, "max": 2.0, "step": 0.01}),
            },
            "optional": {
            },
            "hidden": {
            }
        }


    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "mix_channels"
    CATEGORY = "image/color"


    def mix_channels(
        self,
        version,
        image: torch.Tensor,
        red_in_red: float,
        green_in_red: float,
        blue_in_red: float,
        red_in_green: float,
        green_in_green: float,
        blue_in_green: float,
        red_in_blue: float,
        green_in_blue: float,
        blue_in_blue: float,
    ):
        debug_print("=" * 60)
        debug_print("[OlmChannelMixer] Red output row:", red_in_red, green_in_red, blue_in_red)
        debug_print("[OlmChannelMixer] Green output row:", red_in_green, green_in_green, blue_in_green)
        debug_print("[OlmChannelMixer] Blue output row:", red_in_blue, green_in_blue, blue_in_blue)
        thumbnail_cache["channelmixer_image"] = image.clone().detach()
        matrix = [
            [red_in_red, green_in_red, blue_in_red],
            [red_in_green, green_in_green, blue_in_green],
            [red_in_blue, green_in_blue, blue_in_blue],
        ]
        return {
            "ui": {
                "message": "Processing complete!",
            },
            "result": (apply_mix(image, matrix),),
        }


@PromptServer.instance.routes.post("/olm/api/channelmixer/update")
async def handle_channelmixer_preview(request):
    debug_print("[OlmChannelMixer] /olm/api/channelmixer/update")
    try:
        data = await request.json()
        debug_print("[OlmChannelMixer] Received preview request:", data)
        matrix = data.get("matrix")
        if not matrix:
            raise ValueError("[OlmChannelMixer] Missing matrix in request.")
        image = load_thumbnail_image()
        tensor = apply_mix(image, matrix)
        img = tensor_to_pil(tensor)
        img_str = encode_to_base64(img)
        return web.json_response({
            "status": "success",
            "updatedimage": f"data:image/png;base64,{img_str}"
        })
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=400)


def load_thumbnail_image():
    if "channelmixer_image" not in thumbnail_cache:
        raise ValueError("[OlmChannelMixer] No cached image available. Please run the node first.")
    image = thumbnail_cache["channelmixer_image"]
    thumbnail = downscale_image(image, size=(PREVIEW_RESOLUTION, PREVIEW_RESOLUTION))
    return thumbnail


def apply_mix(image, matrix):
    if image.dim() == 3:
        image = image.unsqueeze(0)
    B, H, W, C = image.shape
    r, g, b = image[..., 0], image[..., 1], image[..., 2]
    mixer_matrix = torch.tensor(matrix, device=image.device, dtype=image.dtype).T
    pixels = image.view(-1, 3)
    new_pixels = torch.matmul(pixels, mixer_matrix)
    mixed_image = new_pixels.view(B, H, W, 3)
    return torch.clamp(mixed_image, 0.0, 1.0)


def tensor_to_pil(tensor):
    tensor = tensor.squeeze(0).cpu().numpy()
    return Image.fromarray((tensor * 255).astype("uint8"))


def encode_to_base64(img: Image.Image) -> str:
    buffered = BytesIO()
    img.save(buffered, format="PNG")
    return base64.b64encode(buffered.getvalue()).decode("utf-8")


def downscale_image(tensor, size=(PREVIEW_RESOLUTION, PREVIEW_RESOLUTION)):
    if tensor.dim() == 3:
        tensor = tensor.unsqueeze(0)
    B, H, W, C = tensor.shape
    max_w, max_h = size
    aspect = W / H
    if W / max_w > H / max_h:
        target_w = max_w
        target_h = round(max_w / aspect)
    else:
        target_h = max_h
        target_w = round(max_h * aspect)
    resized = torch.nn.functional.interpolate(
        tensor.permute(0, 3, 1, 2),
        size=(target_h, target_w),
        mode='bilinear',
        align_corners=False
    ).permute(0, 2, 3, 1)
    return resized.squeeze(0)


WEB_DIRECTORY = "./web"


NODE_CLASS_MAPPINGS = {
    "OlmChannelMixer": OlmChannelMixer
}


NODE_DISPLAY_NAME_MAPPINGS = {
    "OlmChannelMixer": "Olm Channel Mixer"
}
