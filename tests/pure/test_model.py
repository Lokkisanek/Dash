"""Guest data model: hashing, expiry, revoke, codes, audit, migration."""

from datetime import UTC, datetime, timedelta
import json

from _loader import load
import pytest

model_mod = load("guest_model")
codes = load("guest_codes")
const = load("const")

GuestData = model_mod.GuestData
GuestError = model_mod.GuestError
NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)


def _profile(data, **extra):
    return data.profile_save(
        {
            "name": "Pokoj 3",
            "entities": {"light.room3": {}, "sensor.room3_temp": {}},
            **extra,
        },
        NOW,
    )


def _phone_pass(data, profile_id, hours=24, start=None):
    return data.pass_create(
        profile_id=profile_id,
        label="Pokoj 3 - Novák",
        kind="phone",
        valid_from=start,
        valid_until=model_mod.iso(NOW + timedelta(hours=hours)),
        now=NOW,
    )


def test_no_plaintext_secrets_in_storage() -> None:
    data = GuestData()
    profile = _profile(data)
    _pass, code = _phone_pass(data, profile["id"])
    paired = data.pair(code["code"], NOW + timedelta(minutes=1))
    assert paired is not None
    _p, token = paired
    blob = json.dumps(data.data)
    assert token not in blob
    assert code["code"] not in blob
    assert code["code"].replace("-", "") not in blob
    assert codes.hash_secret(token) in blob


def test_pair_once_then_code_is_dead() -> None:
    data = GuestData()
    profile = _profile(data)
    _pass, code = _phone_pass(data, profile["id"])
    assert data.pair(code["code"], NOW) is not None
    assert data.pair(code["code"], NOW) is None


def test_code_ttl() -> None:
    data = GuestData()
    profile = _profile(data)
    _pass, code = _phone_pass(data, profile["id"])
    late = NOW + timedelta(seconds=const.PAIR_CODE_TTL_SECONDS)
    assert data.pair(code["code"], late) is None


def test_code_case_and_dashes_ignored() -> None:
    data = GuestData()
    profile = _profile(data)
    _pass, code = _phone_pass(data, profile["id"])
    assert data.pair(code["code"].lower().replace("-", " "), NOW) is not None


def test_new_code_invalidates_old_one() -> None:
    data = GuestData()
    profile = _profile(data)
    pass_, first = _phone_pass(data, profile["id"])
    second = data.pass_new_code(pass_["id"], NOW)
    assert data.pair(first["code"], NOW) is None
    assert data.pair(second["code"], NOW) is not None


def test_repairing_replaces_the_token() -> None:
    data = GuestData()
    profile = _profile(data)
    pass_, code = _phone_pass(data, profile["id"])
    _p, old_token = data.pair(code["code"], NOW)
    new_code = data.pass_new_code(pass_["id"], NOW)
    _p, new_token = data.pair(new_code["code"], NOW)
    assert data.find_by_token(old_token) is None
    assert data.find_by_token(new_token)["id"] == pass_["id"]


def test_revoke_kills_token_and_codes() -> None:
    data = GuestData()
    profile = _profile(data)
    pass_, code = _phone_pass(data, profile["id"])
    _p, token = data.pair(code["code"], NOW)
    spare = data.pass_new_code(pass_["id"], NOW)
    data.pass_revoke(pass_["id"], NOW)
    assert data.find_by_token(token) is None
    assert data.pair(spare["code"], NOW) is None
    assert GuestData.status(data.data["passes"][pass_["id"]], NOW) == "revoked"
    with pytest.raises(GuestError):
        data.pass_new_code(pass_["id"], NOW)


def test_status_transitions() -> None:
    data = GuestData()
    profile = _profile(data)
    start = model_mod.iso(NOW + timedelta(hours=2))
    pass_, _code = _phone_pass(data, profile["id"], hours=10, start=start)
    stored = data.data["passes"][pass_["id"]]
    assert GuestData.status(stored, NOW) == "pending"
    assert GuestData.status(stored, NOW + timedelta(hours=3)) == "active"
    assert GuestData.status(stored, NOW + timedelta(hours=10)) == "expired"


def test_expired_pass_cannot_pair() -> None:
    data = GuestData()
    profile = _profile(data)
    _pass, code = _phone_pass(data, profile["id"], hours=1)
    # code is still within its TTL, but the pass itself ended
    data.data["passes"][_pass["id"]]["valid_until"] = model_mod.iso(
        NOW - timedelta(minutes=1)
    )
    assert data.pair(code["code"], NOW) is None


def test_corrupt_valid_until_fails_closed() -> None:
    data = GuestData()
    profile = _profile(data)
    pass_, _code = _phone_pass(data, profile["id"])
    stored = data.data["passes"][pass_["id"]]
    stored["valid_until"] = "not a date"
    assert GuestData.status(stored, NOW) == "expired"


def test_phone_requires_end_tablet_does_not() -> None:
    data = GuestData()
    profile = _profile(data)
    with pytest.raises(GuestError) as err:
        data.pass_create(
            profile_id=profile["id"],
            label="x",
            kind="phone",
            valid_from=None,
            valid_until=None,
            now=NOW,
        )
    assert err.value.code == "valid_until_required"
    tablet, _code = data.pass_create(
        profile_id=profile["id"],
        label="Tablet",
        kind="tablet",
        valid_from=None,
        valid_until=None,
        now=NOW,
    )
    assert tablet["valid_until"] is None
    assert tablet["status"] == "active"


def test_extend_and_bad_ranges() -> None:
    data = GuestData()
    profile = _profile(data)
    pass_, _code = _phone_pass(data, profile["id"])
    later = model_mod.iso(NOW + timedelta(days=3))
    assert data.pass_extend(pass_["id"], later, NOW)["valid_until"] == later
    with pytest.raises(GuestError):
        data.pass_extend(pass_["id"], model_mod.iso(NOW - timedelta(days=1)), NOW)
    with pytest.raises(GuestError):
        data.pass_create(
            profile_id=profile["id"],
            label="x",
            kind="phone",
            valid_from=later,
            valid_until=model_mod.iso(NOW),
            now=NOW,
        )


def test_delete_pass_and_profile_in_use() -> None:
    data = GuestData()
    profile = _profile(data)
    pass_, code = _phone_pass(data, profile["id"])
    _p, token = data.pair(code["code"], NOW)
    with pytest.raises(GuestError) as err:
        data.profile_delete(profile["id"], NOW)
    assert err.value.code == "profile_in_use"
    data.pass_delete(pass_["id"], NOW)
    assert data.find_by_token(token) is None
    data.profile_delete(profile["id"], NOW)
    assert data.data["profiles"] == {}


def test_audit_is_capped_and_has_no_secrets() -> None:
    data = GuestData()
    profile = _profile(data)
    _pass, code = _phone_pass(data, profile["id"])
    for _ in range(const.AUDIT_MAX_ENTRIES + 50):
        data.pair("ZZZZ-ZZZZ-ZZZZ", NOW, ip="203.0.113.9")
    _p, token = data.pair(code["code"], NOW)
    log = data.data["audit"]
    assert len(log) == const.AUDIT_MAX_ENTRIES
    blob = json.dumps(log)
    assert token not in blob and code["code"] not in blob and "ZZZZ" not in blob
    assert log[-1]["event"] == "pair_ok"


def test_last_seen_throttled() -> None:
    data = GuestData()
    profile = _profile(data)
    _pass, code = _phone_pass(data, profile["id"])
    stored, _token = data.pair(code["code"], NOW)
    assert not data.touch(stored, NOW + timedelta(minutes=4))
    assert data.touch(stored, NOW + timedelta(minutes=6))


def test_reload_from_storage_keeps_tokens_working() -> None:
    data = GuestData()
    profile = _profile(data)
    _pass, code = _phone_pass(data, profile["id"])
    _p, token = data.pair(code["code"], NOW)
    reloaded = GuestData(json.loads(json.dumps(data.data)))
    assert reloaded.find_by_token(token) is not None


def test_migration_tolerates_garbage() -> None:
    assert model_mod.migrate(1, None) == model_mod.empty_data()
    assert (
        model_mod.migrate(1, {"profiles": [], "passes": "x"}) == model_mod.empty_data()
    )
    kept = model_mod.migrate(1, {"profiles": {"a": {}}, "unknown": 1})
    assert kept["profiles"] == {"a": {}} and "unknown" not in kept


def test_find_by_token_rejects_junk() -> None:
    data = GuestData()
    for junk in (None, "", "short", 5, "x" * 500, ["a"]):
        assert data.find_by_token(junk) is None
