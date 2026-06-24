"""
S3 Service -- Inevi
====================
Handles image uploads to AWS S3 bucket.
Images are stored publicly and served via S3 URL.
"""

import os
import uuid
import boto3
from dotenv import load_dotenv

load_dotenv()

S3_BUCKET             = os.getenv("S3_BUCKET", "")
S3_REGION             = os.getenv("S3_REGION", "ap-southeast-2")
AWS_ACCESS_KEY_ID     = os.getenv("AWS_ACCESS_KEY_ID", "")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", "")


def get_s3_client():
    return boto3.client(
        "s3",
        region_name=S3_REGION,
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    )


def upload_image(image_bytes: bytes, filename: str, mime_type: str = "image/jpeg") -> str:
    """
    Upload image bytes to S3 bucket.
    Returns the public URL of the uploaded image.
    """
    ext       = filename.split(".")[-1] if "." in filename else "jpg"
    key       = f"locations/{uuid.uuid4()}.{ext}"
    client    = get_s3_client()

    client.put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=image_bytes,
        ContentType=mime_type,
    )

    url = f"https://{S3_BUCKET}.s3.{S3_REGION}.amazonaws.com/{key}"
    return url


def delete_image(url: str) -> bool:
    """Delete an image from S3 by its URL."""
    try:
        key    = url.split(".amazonaws.com/")[-1]
        client = get_s3_client()
        client.delete_object(Bucket=S3_BUCKET, Key=key)
        return True
    except Exception:
        return False


def get_presigned_url(key: str, expires_in: int = 3600) -> str:
    """Generate a presigned URL for private access (optional use)."""
    client = get_s3_client()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": S3_BUCKET, "Key": key},
        ExpiresIn=expires_in,
    )