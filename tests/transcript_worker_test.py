"""Extractor boundary tests; no network requests, credentials, or model calls."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch, MagicMock

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "fetch-transcript.py"
spec = importlib.util.spec_from_file_location("caption_worker", SCRIPT)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class Fetched(list):
    language_code = "hi"


def track(language, generated):
    result = MagicMock(language_code=language, is_generated=generated)
    result.fetch.return_value = Fetched([
        SimpleNamespace(text=" नमस्ते ", start=1.25, duration=2.5),
        SimpleNamespace(text=" ", start=4.0, duration=1.0),
    ])
    return result


class ExtractorTests(unittest.TestCase):
    @patch.dict(os.environ, {}, clear=True)
    @patch("youtube_transcript_api.YouTubeTranscriptApi")
    def test_native_captions_preserve_text_and_timing(self, api):
        generated, manual = track("hi", True), track("hi", False)
        api.return_value.list.return_value = [generated, manual]
        reply = worker.extract("abcdefghijk")
        self.assertTrue(reply["ok"])
        self.assertEqual(reply["transcript"]["content"], [{"text": "नमस्ते", "offset": 1250, "duration": 2500}])
        manual.fetch.assert_called_once()
        generated.fetch.assert_not_called()

    @patch.dict(os.environ, {"TRANSCRIPT_LANGUAGE": "hi", "TRANSCRIPT_PROXY_URL": "http://user:secret@gateway.example:8000"}, clear=True)
    @patch("youtube_transcript_api.YouTubeTranscriptApi")
    def test_language_and_proxy_are_applied_without_ai_generation(self, api):
        english, hindi = track("en", False), track("hi", True)
        api.return_value.list.return_value = [english, hindi]
        self.assertTrue(worker.extract("abcdefghijk")["ok"])
        hindi.fetch.assert_called_once()
        english.fetch.assert_not_called()
        proxy = api.call_args.kwargs["proxy_config"]
        self.assertEqual(proxy.to_requests_dict()["https"], os.environ["TRANSCRIPT_PROXY_URL"])
        self.assertFalse(api.call_args.kwargs["http_client"].trust_env)

    @patch.dict(os.environ, {"TRANSCRIPT_PROXY_URL": "file:///private"}, clear=True)
    def test_bad_proxy_configuration(self):
        self.assertEqual(worker.extract("abcdefghijk"), {"ok": False, "code": "setup"})

    def test_protocol_checks_dependencies_and_rejects_invalid_video(self):
        for argument, expected in [("--check", {"ok": True, "ready": True}), ("../../.env.local", {"ok": False, "code": "invalid"})]:
            result = subprocess.run([sys.executable, "-X", "utf8", str(SCRIPT), argument], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(json.loads(result.stdout), expected)
            self.assertEqual(result.stderr, "")

    @patch("youtube_transcript_api.YouTubeTranscriptApi")
    def test_blocked_errors_never_print_credentials(self, api):
        from youtube_transcript_api._errors import RequestBlocked
        api.return_value.list.side_effect = RequestBlocked("abcdefghijk")
        from io import StringIO
        output = StringIO()
        with patch.object(sys, "argv", [str(SCRIPT), "abcdefghijk"]), patch("sys.stdout", output):
            self.assertEqual(worker.main(), 0)
        self.assertEqual(json.loads(output.getvalue()), {"ok": False, "code": "blocked"})


if __name__ == "__main__":
    unittest.main()
