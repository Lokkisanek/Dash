"""Makes custom_components a regular package so pytest imports this repository's integration.

Home Assistant's test harness puts its own testing_config (which has a
custom_components package) on sys.path; without this file it would shadow ours.
HACS and Home Assistant only use custom_components/<domain>/.
"""
