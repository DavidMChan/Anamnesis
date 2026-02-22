"""
Wasabi media client for downloading and encoding media files.

Downloads media from Wasabi (S3-compatible) and returns base64-encoded
data ready for inclusion in multimodal LLM prompts.
"""
import base64
import logging
from typing import Optional, List, Tuple

import boto3

from .prompt import Question, MediaAttachment, QuestionMedia

logger = logging.getLogger(__name__)


class WasabiMediaClient:
    """Download media from Wasabi for LLM prompts."""

    def __init__(
        self,
        access_key: str,
        secret_key: str,
        bucket: str,
        endpoint: str = "https://s3.wasabisys.com",
        **_kwargs,
    ):
        self.bucket = bucket
        # Wasabi docs: don't pass region_name, just endpoint_url
        self.s3 = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
        )

    def download_and_encode(self, key: str, mime_type: str) -> Tuple[str, str]:
        """
        Download file from Wasabi and return (base64_data, mime_type).

        Args:
            key: Wasabi object key (e.g., "media/abc123/image.png")
            mime_type: MIME type of the file

        Returns:
            Tuple of (base64_encoded_data, mime_type)
        """
        logger.info(f"Downloading media: {key}")
        response = self.s3.get_object(Bucket=self.bucket, Key=key)
        data = response["Body"].read()
        encoded = base64.b64encode(data).decode("utf-8")
        logger.info(f"Downloaded and encoded {key} ({len(data)} bytes)")
        return encoded, mime_type

    def download_media_for_question(self, question: Question) -> Optional[QuestionMedia]:
        """
        Download all media for a question (question-level + option-level).

        Returns a QuestionMedia object with base64-encoded data ready for LLM,
        or None if the question has no media.
        """
        if not question.has_media:
            return None

        question_media_data = None
        option_media_data = None

        # Download question-level media
        if question.media:
            question_media_data = self.download_and_encode(
                question.media.key, question.media.type
            )

        # Download per-option media
        if question.option_media:
            option_media_data = []
            for opt_media in question.option_media:
                if opt_media:
                    option_media_data.append(
                        self.download_and_encode(opt_media.key, opt_media.type)
                    )
                else:
                    option_media_data.append(None)

        return QuestionMedia(
            question_media=question_media_data,
            option_media=option_media_data,
        )
