#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, BytesN, Env,
};

fn env_with_timestamp(ts: u64) -> Env {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = ts);
    env
}

#[test]
fn test_commit_and_verify() {
    let env = env_with_timestamp(1_000_000);
    let contract_id = env.register(ZkVerifier, ());
    let client = ZkVerifierClient::new(&env, &contract_id);

    let auditor = Address::generate(&env);
    let contract_addr = Address::generate(&env);
    let commitment: BytesN<32> = BytesN::from_array(&env, &[1u8; 32]);

    env.mock_all_auths();
    client.commit(&auditor, &contract_addr, &commitment);

    let record = client.get_commitment(&auditor);
    assert_eq!(record.contract_address, contract_addr);
    assert_eq!(record.commitment, commitment);
    assert!(!record.verified);

    client.verify_and_claim(&auditor, &contract_addr, &commitment);

    let record = client.get_commitment(&auditor);
    assert!(record.verified);
}
