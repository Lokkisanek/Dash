"""Pairing codes, tokens and hashing."""

from _loader import load

codes = load("guest_codes")
const = load("const")


def test_code_alphabet_and_length() -> None:
    for _ in range(200):
        code = codes.new_pair_code()
        assert len(code) == const.PAIR_CODE_LENGTH
        assert set(code) <= set(const.PAIR_ALPHABET)
        assert not set(code) & set("0O1IL")


def test_alphabet_has_no_ambiguous_symbols() -> None:
    assert len(set(const.PAIR_ALPHABET)) == len(const.PAIR_ALPHABET) == 31
    assert not set(const.PAIR_ALPHABET) & set("0O1IL")


def test_format_and_normalize_roundtrip() -> None:
    code = codes.new_pair_code()
    shown = codes.format_pair_code(code)
    assert shown.count("-") == 2 and len(shown) == 14
    assert codes.normalize_pair_code(shown) == code
    assert codes.normalize_pair_code(shown.lower()) == code
    assert codes.normalize_pair_code(" ".join(shown.split("-"))) == code


def test_normalize_rejects_garbage() -> None:
    for bad in (
        None,
        123,
        "",
        "ABC",
        "0000-0000-0000",
        "AAAA-AAAA-AAA",
        "A" * 100,
        ["x"],
    ):
        assert codes.normalize_pair_code(bad) is None


def test_tokens_are_long_and_unique() -> None:
    tokens = {codes.new_token() for _ in range(100)}
    assert len(tokens) == 100
    assert all(len(t) >= 40 for t in tokens)


def test_hash_is_sha256_hex_and_compare() -> None:
    digest = codes.hash_secret("abc")
    assert len(digest) == 64 and int(digest, 16) >= 0
    assert codes.hashes_equal(digest, codes.hash_secret("abc"))
    assert not codes.hashes_equal(digest, codes.hash_secret("abd"))
