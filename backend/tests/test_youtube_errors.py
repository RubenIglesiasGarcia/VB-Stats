"""YouTube rejection messages must be honest and must not leak credentials."""
from backend.vision.youtube_import import describe_download_failure


def test_youtube_datacenter_bot_challenge_is_identified():
    text = describe_download_failure(
        RuntimeError("ERROR: [youtube] ul-pA6pLWX8: Sign in to confirm you're not a bot.")
    )
    assert "bloqueado" in text
    assert "Railway" in text
    assert "archivo original" in text
    assert "privado" in text  # Explicitly says this does NOT imply private content.


def test_youtube_private_recording_has_distinct_message():
    text = describe_download_failure(RuntimeError("ERROR: private video"))
    assert "no es accesible" in text
    assert "bot" not in text


def test_uncategorized_youtube_error_is_safe_and_generic():
    text = describe_download_failure(
        RuntimeError("HTTP 500, secret-token=private-internal-value")
    )
    assert "secret-token" not in text
    assert "YouTube" in text
