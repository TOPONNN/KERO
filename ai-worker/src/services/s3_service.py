import os
import boto3
from botocore.exceptions import ClientError
from src.config import AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET, TEMP_DIR


class S3Service:
    def __init__(self):
        self.s3_client = boto3.client(
            "s3",
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
            region_name=AWS_REGION,
        )
        self.bucket = S3_BUCKET

    def download_file(self, s3_key: str, local_path: str = None) -> str:
        if local_path is None:
            filename = os.path.basename(s3_key)
            local_path = os.path.join(TEMP_DIR, filename)

        os.makedirs(os.path.dirname(local_path), exist_ok=True)

        try:
            self.s3_client.download_file(self.bucket, s3_key, local_path)
            return local_path
        except ClientError as e:
            print(f"Error downloading {s3_key}: {e}")
            raise

    def upload_file(self, local_path: str, s3_key: str) -> str:
        try:
            self.s3_client.upload_file(
                local_path,
                self.bucket,
                s3_key,
                ExtraArgs={"ContentType": self._get_content_type(local_path)},
            )
            return f"https://{self.bucket}.s3.{AWS_REGION}.amazonaws.com/{s3_key}"
        except ClientError as e:
            print(f"Error uploading {local_path}: {e}")
            raise

    def _get_content_type(self, filepath: str) -> str:
        ext = os.path.splitext(filepath)[1].lower()
        content_types = {
            ".mp3": "audio/mpeg",
            ".opus": "audio/ogg",
            ".wav": "audio/wav",
            ".flac": "audio/flac",
            ".json": "application/json",
        }
        return content_types.get(ext, "application/octet-stream")


s3_service = S3Service()
