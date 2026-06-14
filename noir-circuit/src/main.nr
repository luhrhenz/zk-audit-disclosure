use std::hash::pedersen_hash;

fn main(secret_hash: Field, contract_address: pub Field, commitment: pub Field) {
    let computed_commitment = pedersen_hash([secret_hash, contract_address]);
    assert(computed_commitment == commitment);
}

#[test]
fn test_valid_commitment() {
    let secret: Field = 1;
    let addr: Field = 42;
    let expected = pedersen_hash([secret, addr]);
    main(secret, addr, expected);
}
