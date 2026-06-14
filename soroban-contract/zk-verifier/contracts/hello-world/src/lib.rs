#![no_std]
use soroban_sdk::{contract, contractevent, contractimpl, contracttype, Address, BytesN, Env};

#[contracttype]
#[derive(Clone)]
pub struct CommitmentRecord {
    pub contract_address: Address,
    pub commitment: BytesN<32>,
    pub verified: bool,
    pub timestamp: u64,
}

#[contracttype]
pub enum DataKey {
    Commitment(Address),
}

#[contractevent]
pub struct CommittedEvent {
    pub auditor: Address,
    pub contract_address: Address,
    pub commitment: BytesN<32>,
    pub timestamp: u64,
}

#[contractevent]
pub struct VerifiedEvent {
    pub auditor: Address,
    pub contract_address: Address,
    pub commitment: BytesN<32>,
}

#[contract]
pub struct ZkVerifier;

#[contractimpl]
impl ZkVerifier {
    /// Store a new commitment: auditor binds a secret to a specific contract address.
    pub fn commit(
        env: Env,
        auditor: Address,
        contract_address: Address,
        commitment: BytesN<32>,
    ) {
        auditor.require_auth();

        let timestamp = env.ledger().timestamp();
        let record = CommitmentRecord {
            contract_address: contract_address.clone(),
            commitment: commitment.clone(),
            verified: false,
            timestamp,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Commitment(auditor.clone()), &record);

        CommittedEvent {
            auditor,
            contract_address,
            commitment,
            timestamp,
        }
        .publish(&env);
    }

    /// Check the stored commitment matches and mark it verified.
    pub fn verify_and_claim(
        env: Env,
        auditor: Address,
        contract_address: Address,
        commitment: BytesN<32>,
    ) {
        auditor.require_auth();

        let key = DataKey::Commitment(auditor.clone());
        let mut record: CommitmentRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("no commitment found"));

        if record.contract_address != contract_address {
            panic!("contract address mismatch");
        }
        if record.commitment != commitment {
            panic!("commitment mismatch");
        }
        if record.verified {
            panic!("already verified");
        }

        record.verified = true;
        env.storage().persistent().set(&key, &record);

        VerifiedEvent {
            auditor,
            contract_address,
            commitment,
        }
        .publish(&env);
    }

    /// Return the stored commitment record for an auditor.
    pub fn get_commitment(env: Env, auditor: Address) -> CommitmentRecord {
        env.storage()
            .persistent()
            .get(&DataKey::Commitment(auditor))
            .unwrap_or_else(|| panic!("no commitment found"))
    }
}

mod test;
