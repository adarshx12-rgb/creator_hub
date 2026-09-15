"""One bounded caption request. JSON stdout is the private Node worker protocol."""
import json
import os
import re
import sys
from urllib.parse import urlparse


def extract(video_id):
    from requests import Session
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api.proxies import GenericProxyConfig

    class BoundedSession(Session):
        def request(self, *args, **kwargs):
            kwargs.setdefault("timeout", (8, 15))
            return super().request(*args, **kwargs)

    proxy_url = os.environ.get("TRANSCRIPT_PROXY_URL", "").strip()
    proxy = None
    if proxy_url:
        parsed = urlparse(proxy_url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return {"ok": False, "code": "setup"}
        proxy = GenericProxyConfig(http_url=proxy_url, https_url=proxy_url)

    with BoundedSession() as session:
        session.trust_env = False
        # Each invocation opens a new session; rotating gateways choose the exit IP.
        api = YouTubeTranscriptApi(proxy_config=proxy, http_client=session)
        tracks = list(api.list(video_id))
        language = os.environ.get("TRANSCRIPT_LANGUAGE", "").strip()
        preferred = [track for track in tracks if track.language_code == language] if language else tracks
        candidates = preferred or tracks
        if not candidates:
            return {"ok": False, "code": "unavailable"}
        track = next((item for item in candidates if not item.is_generated), candidates[0])
        result = track.fetch()
        cues = [{"text": cue.text.strip(), "offset": cue.start * 1000, "duration": cue.duration * 1000}
                for cue in result if cue.text.strip()]
        if not cues:
            return {"ok": False, "code": "unavailable"}
        return {"ok": True, "transcript": {"lang": result.language_code, "content": cues}}


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "--check":
        try:
            from youtube_transcript_api import YouTubeTranscriptApi  # noqa: F401
            print(json.dumps({"ok": True, "ready": True}))
        except ImportError:
            print(json.dumps({"ok": False, "code": "setup"}))
            return 1
        return 0
    if len(sys.argv) != 2 or not re.fullmatch(r"[A-Za-z0-9_-]{11}", sys.argv[1]):
        print(json.dumps({"ok": False, "code": "invalid"}))
        return 0
    try:
        reply = extract(sys.argv[1])
    except ImportError:
        reply = {"ok": False, "code": "setup"}
    except Exception as error:
        # Never send provider exception strings (which can contain proxy credentials) to Node/logs.
        names = {cls.__name__ for cls in type(error).__mro__}
        if names & {"RequestBlocked", "IpBlocked"}:
            code = "blocked"
        elif names & {"TranscriptsDisabled", "NoTranscriptFound", "VideoUnavailable", "VideoUnplayable", "AgeRestricted"}:
            code = "unavailable"
        elif names & {"InvalidURL", "InvalidSchema", "MissingSchema"}:
            code = "setup"
        else:
            code = "temporary"
        reply = {"ok": False, "code": code}
    print(json.dumps(reply, ensure_ascii=True, allow_nan=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
