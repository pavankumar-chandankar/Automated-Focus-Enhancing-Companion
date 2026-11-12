import pytest
from focusbuddy.domain.privacy import PrivacyViolation, scrub_for_display, validate_aggregate


def test_valid_aggregate(signal_payload):
    assert validate_aggregate(signal_payload).context_switch_count == 11

@pytest.mark.parametrize('private_key', ['keystrokes','window_title','clipboard','screenshot','url','password'])
def test_raw_private_input_rejected(private_key, signal_payload):
    with pytest.raises(PrivacyViolation):
        validate_aggregate({**signal_payload, private_key:'sensitive'})

@pytest.mark.parametrize('field,value', [('elapsed_minutes',-1), ('focused_minutes',181),
                                         ('context_switch_count',-1),('self_report_energy',6)])
def test_out_of_range_rejected(field,value,signal_payload):
    with pytest.raises(PrivacyViolation):
        validate_aggregate({**signal_payload,field:value})

def test_contradictory_aggregate_rejected(signal_payload):
    with pytest.raises(PrivacyViolation):
        validate_aggregate({**signal_payload,'focused_minutes':24,'idle_minutes':4})

def test_empty_object_rejected():
    with pytest.raises(PrivacyViolation):
        validate_aggregate({})

def test_scrub_control_characters():
    assert '\x00' not in scrub_for_display('hello\x00world')
