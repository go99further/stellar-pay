#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env, String,
};

#[contracttype]
pub enum DataKey {
    Admin,
    Minter,
    Name,
    Symbol,
    Balance(Address),
    TotalSupply,
}

#[contract]
pub struct RewardToken;

#[contractimpl]
impl RewardToken {
    /// Initialize the token with admin, name, and symbol.
    pub fn initialize(env: Env, admin: Address, name: String, symbol: String) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        env.storage().instance().set(&DataKey::TotalSupply, &0i128);
    }

    /// Set the minter address (admin only). Used to authorize the Poll contract for cross-contract mint.
    pub fn set_minter(env: Env, minter: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Minter, &minter);
    }

    /// Mint tokens to an address.
    /// Accepts authorization from either the admin or the designated minter (Poll contract).
    pub fn mint(env: Env, to: Address, amount: i128) {
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        let minter_opt: Option<Address> = env.storage().instance().get(&DataKey::Minter);

        // Accept auth from admin or designated minter
        match minter_opt {
            Some(minter) => {
                // Require auth from minter (Poll contract invoking this)
                minter.require_auth();
            }
            None => {
                admin.require_auth();
            }
        }

        let balance: i128 = env.storage().persistent()
            .get(&DataKey::Balance(to.clone()))
            .unwrap_or(0);
        env.storage().persistent()
            .set(&DataKey::Balance(to.clone()), &(balance + amount));

        let supply: i128 = env.storage().instance()
            .get(&DataKey::TotalSupply).unwrap_or(0);
        env.storage().instance()
            .set(&DataKey::TotalSupply, &(supply + amount));

        env.events().publish(
            (symbol_short!("token"), symbol_short!("mint")),
            (to, amount),
        );
    }

    /// Transfer tokens between addresses.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }

        let from_bal: i128 = env.storage().persistent()
            .get(&DataKey::Balance(from.clone()))
            .unwrap_or(0);
        if from_bal < amount {
            panic!("insufficient balance");
        }

        let to_bal: i128 = env.storage().persistent()
            .get(&DataKey::Balance(to.clone()))
            .unwrap_or(0);

        env.storage().persistent()
            .set(&DataKey::Balance(from.clone()), &(from_bal - amount));
        env.storage().persistent()
            .set(&DataKey::Balance(to.clone()), &(to_bal + amount));

        env.events().publish(
            (symbol_short!("token"), symbol_short!("xfer")),
            (from, to, amount),
        );
    }

    // ── Read-only functions ──

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage().persistent()
            .get(&DataKey::Balance(id))
            .unwrap_or(0)
    }

    pub fn name(env: Env) -> String {
        env.storage().instance().get(&DataKey::Name)
            .unwrap_or(String::from_str(&env, ""))
    }

    pub fn symbol(env: Env) -> String {
        env.storage().instance().get(&DataKey::Symbol)
            .unwrap_or(String::from_str(&env, ""))
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage().instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }
}
