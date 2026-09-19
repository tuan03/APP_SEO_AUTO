"""Minimal Gemini 3.8 Flash request through Google Cloud Vertex AI."""

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types


def main() -> int:
    load_dotenv()
    parser = argparse.ArgumentParser(description="Describe img.png with Gemini 3.8 Flash on Vertex AI")
    parser.add_argument(
        "prompt",
        nargs="?",
        default="Hãy mô tả bằng tiếng Việt những gì bạn hiểu được từ hình ảnh này. Nêu các chi tiết chính và chữ nhìn thấy được (nếu có).",
    )
    args = parser.parse_args()

    image_path = Path(__file__).resolve().parent / "img.png"
    if not image_path.is_file():
        parser.error(f"Không tìm thấy ảnh: {image_path}")

    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if not project:
        parser.error("Set GOOGLE_CLOUD_PROJECT to your Google Cloud project ID.")

    try:
        with genai.Client(vertexai=True, project=project, location="global") as client:
            response = client.models.generate_content(
                model="gemini-3.8-flash",
                contents=[
                    types.Part.from_text(text=args.prompt),
                    types.Part.from_bytes(data=image_path.read_bytes(), mime_type="image/png"),
                ],
            )
        if not response.text:
            print("Gemini returned no text.", file=sys.stderr)
            return 1
        print(response.text)
        usage = response.usage_metadata
        if usage:
            print("\nToken usage:")
            print(f"  Input: {usage.prompt_token_count if usage.prompt_token_count is not None else 'N/A'}")
            print(f"  Output: {usage.candidates_token_count if usage.candidates_token_count is not None else 'N/A'}")
            print(f"  Cache: {usage.cached_content_token_count or 0}")
        else:
            print("\nToken usage: N/A")
        return 0
    except Exception as exc:
        print(f"Vertex AI request failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
