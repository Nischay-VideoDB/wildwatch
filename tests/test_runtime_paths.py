from pathlib import Path

from wildwatch.runtime_paths import state_file


def test_state_file_uses_local_default(monkeypatch) -> None:
    monkeypatch.delenv("WILDWATCH_STATE_FILE", raising=False)
    assert state_file().name == ".state.json"


def test_state_file_honors_operator_path(monkeypatch, tmp_path: Path) -> None:
    expected = tmp_path / "durable" / "state.json"
    monkeypatch.setenv("WILDWATCH_STATE_FILE", str(expected))
    assert state_file() == expected
