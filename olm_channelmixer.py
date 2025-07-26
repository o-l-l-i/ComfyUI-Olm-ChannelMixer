import torch
from aiohttp import web
from server import PromptServer
import base64
from io import BytesIO
from PIL import Image
from collections import OrderedDict


DEBUG_MODE = False
PREVIEW_RESOLUTION = 512


def debug_print(*args, **kwargs):
    if DEBUG_MODE:
        print(*args, **kwargs)


preview_cache = OrderedDict()
MAX_CACHE_ITEMS = 10


def prune_node_cache(workflow_id, node_id):
    debug_print(
        "[OlmChannelMixer] pruning cache, removing cached data for workflow:",
        workflow_id,
        ", node id:",
        node_id,
    )
    prefix = f"channelmixer_{workflow_id}_{node_id}"
    for key in list(preview_cache.keys()):
        if key.startswith(prefix):
            del preview_cache[key]


class OlmChannelMixer:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "version": ("STRING", {"default": "init"}),
                "image": ("IMAGE",),
                "red_in_red": (
                    "FLOAT",
                    {"default": 1.0, "min": -2.0, "max": 2.0, "step": 0.01},
                ),
                "green_in_red": (
                    "FLOAT",
                    {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.01},
                ),
                "blue_in_red": (
                    "FLOAT",
                    {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.01},
                ),
                "red_in_green": (
                    "FLOAT",
                    {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.01},
                ),
                "green_in_green": (
                    "FLOAT",
                    {"default": 1.0, "min": -2.0, "max": 2.0, "step": 0.01},
                ),
                "blue_in_green": (
                    "FLOAT",
                    {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.01},
                ),
                "red_in_blue": (
                    "FLOAT",
                    {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.01},
                ),
                "green_in_blue": (
                    "FLOAT",
                    {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.01},
                ),
                "blue_in_blue": (
                    "FLOAT",
                    {"default": 1.0, "min": -2.0, "max": 2.0, "step": 0.01},
                ),
            },
            "optional": {},
            "hidden": {
                "extra_pnginfo": "EXTRA_PNGINFO",
                "node_id": "UNIQUE_ID",
            },
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
        extra_pnginfo=None,
        node_id=None,
    ):

        debug_print("=" * 60)
        debug_print(
            "[OlmChannelMixer] Red output row:", red_in_red, green_in_red, blue_in_red
        )
        debug_print(
            "[OlmChannelMixer] Green output row:",
            red_in_green,
            green_in_green,
            blue_in_green,
        )
        debug_print(
            "[OlmChannelMixer] Blue output row:",
            red_in_blue,
            green_in_blue,
            blue_in_blue,
        )

        workflow_id = None
        if extra_pnginfo and "workflow" in extra_pnginfo:
            workflow_id = extra_pnginfo["workflow"].get("id", "unknown")
        if node_id is None:
            node_id = "x"
        cache_key = f"channelmixer_{workflow_id}_{node_id}"
        debug_print("[OlmChannelMixer] cache key:", cache_key)

        prune_node_cache(workflow_id, node_id)
        preview_cache[cache_key] = image.clone().detach()

        preview_cache.move_to_end(cache_key)

        debug_print("[OlmChannelMixer] Cached items count:", len(preview_cache))
        debug_print("[OlmChannelMixer] Current cache keys:", list(preview_cache.keys()))
        if len(preview_cache) > MAX_CACHE_ITEMS:
            oldest_key, _ = preview_cache.popitem(last=False)
            debug_print(f"[OlmChannelMixer] Pruned oldest cache entry: {oldest_key}")

        matrix = [
            [red_in_red, green_in_red, blue_in_red],
            [red_in_green, green_in_green, blue_in_green],
            [red_in_blue, green_in_blue, blue_in_blue],
        ]

        return {
            "ui": {"message": "Processing complete!", "cache_key": cache_key},
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

        key = request.query.get("key")
        if not key:
            return web.json_response(
                {"status": "error", "message": "Missing cache key"}, status=400
            )

        image = load_thumbnail_image(key)
        tensor = apply_mix(image, matrix)

        img = tensor_to_pil(tensor)
        img_str = encode_to_base64(img)

        return web.json_response(
            {"status": "success", "updatedimage": f"data:image/png;base64,{img_str}"}
        )

    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=400)


def load_thumbnail_image(key: str):
    if key not in preview_cache:
        raise ValueError(f"[OlmChannelMixer] No cached image available for key: {key}")
    image = preview_cache[key]
    return downscale_image(image, size=(PREVIEW_RESOLUTION, PREVIEW_RESOLUTION))


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
        mode="bilinear",
        align_corners=False,
    ).permute(0, 2, 3, 1)

    return resized.squeeze(0)


WEB_DIRECTORY = "./web"


NODE_CLASS_MAPPINGS = {"OlmChannelMixer": OlmChannelMixer}


NODE_DISPLAY_NAME_MAPPINGS = {"OlmChannelMixer": "Olm Channel Mixer"}
