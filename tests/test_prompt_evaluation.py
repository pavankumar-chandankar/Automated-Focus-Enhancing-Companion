import json

from focusbuddy.llm.evaluation import evaluate_cases, evaluate_coach_output

GOOD={'title':'Pause', 'message':'Would you like to pause?',
      'rationale':'You supplied time aggregates.',
      'choices':['Pause','Dismiss'],
      'uncertainty':'The inputs do not reveal task quality.',
      'evidence':['Elapsed: 25']}

def test_valid_offline_contract():
    r=evaluate_coach_output('safe','autonomy_v1',json.dumps(GOOD))
    assert r.schema_valid and r.agency_preserved

def test_coercion_rejected():
    r=evaluate_coach_output('bad','autonomy_v1',json.dumps({**GOOD,'message':'You must work NOW'}))
    assert not r.schema_valid

def test_fixture_report(tmp_path):
    path=tmp_path/'cases.jsonl'
    cases=[{'id':'1','prompt_version':'autonomy_v1','candidate_response':GOOD},
           {'id':'2','prompt_version':'autonomy_v1','candidate_response':{**GOOD,'choices':['Work now','Keep working']}}]
    path.write_text('\n'.join(json.dumps(x) for x in cases))
    r=evaluate_cases(path)
    assert r['pass']==1 and r['reject']==1
    assert r['evaluation_type']=='synthetic_contract_fixtures_only'
