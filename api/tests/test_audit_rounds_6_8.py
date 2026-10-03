from copy import deepcopy
from decimal import Decimal as D
import pytest


def draft():
    return {'loan_type':'home_loan','bank':'Future Bank','outstanding':'500000','nominal_rate':'.09','rate_type':'fixed','tenure_months_remaining':120,'scheduled_emi':'6350'}


@pytest.mark.parametrize('endpoint',['/api/simulate','/api/baseline'])
def test_api_includes_future_property_in_trajectory(client,india_user_payload,endpoint):
    u=deepcopy(india_user_payload);u['loans']=[]
    event={'kind':'property_buy','effective_month':3,'loan_draft':draft()}
    response=client.post(endpoint,json={'user':u,'horizon_months':120,'lifecycle_events':[event]})
    assert response.status_code == 200, response.text
    rows=response.json()['trajectory']
    assert D(rows[1]['balances_by_loan_index']['0']) == 0
    assert D(rows[2]['balances_by_loan_index']['0']) > 0
    # Disbursed in month 3, first EMI in month 4.
    assert D(rows[2]['payments_by_loan_index'].get('0', '0')) == 0
    assert D(rows[3]['payments_by_loan_index']['0']) > 0
    assert D(response.json()['total_interest_paid']) > 0


@pytest.mark.parametrize('event',[{'kind':'salary_reset','effective_month':1}, {'kind':'floating_rate_reset','effective_month':1}, {'kind':'property_buy','effective_month':1}])
def test_incomplete_lifecycle_payload_is_rejected(client,india_user_payload,event):
    response=client.post('/api/simulate',json={'user':india_user_payload,'lifecycle_events':[event]})
    assert response.status_code == 422


def test_no_cost_offer_uses_actual_repayments_and_higher_sticker_changes_real_cost(client):
    body={'list_price':'10000','cash_price_elsewhere':'10000','emi_offer_months':6,'emi_offer_monthly_payment':'1666.67','processing_fee':'0','user_savings_after_efund':'50000','country':'IN','monthly_room':'55000'}
    first=client.post('/api/new-debt',json=body)
    assert first.status_code==200
    assert D(first.json()['effective_apr']) < D('.0001')
    raised=client.post('/api/new-debt',json={**body,'list_price':'12000','emi_offer_monthly_payment':'2000'})
    assert raised.status_code==200
    assert D(raised.json()['effective_apr']) > D(first.json()['effective_apr'])
    assert D(raised.json()['total_real_cost']) > D(first.json()['total_real_cost'])


def test_foreign_windfall_is_capped_and_priced_in_residence_currency(client,india_user_payload):
    u=deepcopy(india_user_payload)
    u['loans']=[{**draft(),'loan_type':'personal_loan','currency':'USD','outstanding':'1000','scheduled_emi':'100','nominal_rate':'.18'}]
    u['fx_to_user_currency']={'USD':'80'}
    r=client.post('/api/windfall',json={'user':u,'amount':'10000'})
    assert r.status_code==200, r.text
    data=r.json();assert data['loan_index']==0
    assert D(data['amount'])==D('10000')
    assert D(data['interest_avoided'])>D('100')
    capped=client.post('/api/windfall',json={'user':u,'amount':'100000'})
    assert capped.status_code==200
    assert D(capped.json()['amount'])==D('80000')
    assert D(capped.json()['leftover'])==D('20000')
    u.pop('fx_to_user_currency')
    assert client.post('/api/windfall',json={'user':u,'amount':'10000'}).status_code==422


def test_planned_property_requires_fx_and_obeys_total_loan_limit(client,india_user_payload):
    u=deepcopy(india_user_payload)
    e={'kind':'property_buy','effective_month':3,'loan_draft':{**draft(),'currency':'USD'}}
    assert client.post('/api/simulate',json={'user':u,'lifecycle_events':[e]}).status_code==422
    u['fx_to_user_currency']={'USD':'.01'}
    assert client.post('/api/simulate',json={'user':u,'lifecycle_events':[e],'horizon_months':6}).status_code==200
    u['loans']=[deepcopy(u['loans'][0]) for _ in range(50)]
    assert client.post('/api/simulate',json={'user':u,'lifecycle_events':[e]}).status_code==422
