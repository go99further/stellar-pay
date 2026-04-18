#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env,
};

// Import the compiled LP Token contract WASM for cross-contract calls
mod lp_token {
    soroban_sdk::contractimport!(
        file = "../lp-token/target/wasm32-unknown-unknown/release/lp_token.wasm"
    );
}

// Import the token interface for TokenA / TokenB (SAC-compatible subset)
mod token {
    soroban_sdk::contractimport!(
        file = "../lp-token/target/wasm32-unknown-unknown/release/lp_token.wasm"
    );
}

#[contracttype]
pub enum DataKey {
    Admin,
    TokenA,
    TokenB,
    LpToken,
    ReserveA,
    ReserveB,
}

#[contract]
pub struct AmmContract;

#[contractimpl]
impl AmmContract {
    // ── Initialization ──────────────────────────────────────────────────────────

    /// Initialize the AMM pool.
    /// `token_a` and `token_b` are the two token contract addresses.
    /// `lp_token` is the LP Token contract address (must call set_minter after).
    pub fn initialize(
        env: Env,
        admin: Address,
        token_a: Address,
        token_b: Address,
        lp_token: Address,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TokenA, &token_a);
        env.storage().instance().set(&DataKey::TokenB, &token_b);
        env.storage().instance().set(&DataKey::LpToken, &lp_token);
        env.storage().instance().set(&DataKey::ReserveA, &0i128);
        env.storage().instance().set(&DataKey::ReserveB, &0i128);
    }

    // ── Liquidity ────────────────────────────────────────────────────────────────

    /// Add liquidity to the pool.
    /// Transfers `amount_a` of TokenA and `amount_b` of TokenB from `provider`.
    /// Mints LP tokens proportional to contribution.
    /// `min_lp`: minimum LP tokens expected (slippage guard).
    /// Returns the number of LP tokens minted.
    pub fn add_liquidity(
        env: Env,
        provider: Address,
        amount_a: i128,
        amount_b: i128,
        min_lp: i128,
    ) -> i128 {
        provider.require_auth();

        if amount_a <= 0 || amount_b <= 0 {
            panic!("amounts must be positive");
        }

        let token_a: Address = env.storage().instance().get(&DataKey::TokenA).unwrap();
        let token_b: Address = env.storage().instance().get(&DataKey::TokenB).unwrap();
        let lp_token_addr: Address = env.storage().instance().get(&DataKey::LpToken).unwrap();

        let reserve_a: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ReserveA)
            .unwrap_or(0);
        let reserve_b: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ReserveB)
            .unwrap_or(0);

        let lp_client = lp_token::Client::new(&env, &lp_token_addr);
        let total_supply = lp_client.total_supply();

        // Calculate LP tokens to mint
        let lp_minted: i128 = if total_supply == 0 {
            // First deposit: geometric mean sqrt(a * b)
            integer_sqrt(amount_a * amount_b)
        } else {
            // Subsequent: proportional, take the minimum ratio
            let lp_a = amount_a * total_supply / reserve_a;
            let lp_b = amount_b * total_supply / reserve_b;
            if lp_a < lp_b { lp_a } else { lp_b }
        };

        if lp_minted < min_lp {
            panic!("slippage: lp_minted below min_lp");
        }
        if lp_minted <= 0 {
            panic!("zero lp minted");
        }

        // Transfer tokens from provider to this contract (AMM holds reserves)
        let ta_client = token::Client::new(&env, &token_a);
        let tb_client = token::Client::new(&env, &token_b);
        let amm_addr = env.current_contract_address();
        ta_client.transfer(&provider, &amm_addr, &amount_a);
        tb_client.transfer(&provider, &amm_addr, &amount_b);

        // Update reserves
        env.storage()
            .instance()
            .set(&DataKey::ReserveA, &(reserve_a + amount_a));
        env.storage()
            .instance()
            .set(&DataKey::ReserveB, &(reserve_b + amount_b));

        // Mint LP tokens to provider
        lp_client.mint(&provider, &lp_minted);

        env.events().publish(
            (symbol_short!("amm"), symbol_short!("add_liq")),
            (provider, amount_a, amount_b, lp_minted),
        );

        lp_minted
    }

    /// Remove liquidity from the pool.
    /// Burns `lp_amount` LP tokens from `provider`.
    /// `min_a` / `min_b`: minimum token amounts expected (slippage guard).
    /// Returns (amount_a_returned, amount_b_returned).
    pub fn remove_liquidity(
        env: Env,
        provider: Address,
        lp_amount: i128,
        min_a: i128,
        min_b: i128,
    ) -> (i128, i128) {
        provider.require_auth();

        if lp_amount <= 0 {
            panic!("lp_amount must be positive");
        }

        let token_a: Address = env.storage().instance().get(&DataKey::TokenA).unwrap();
        let token_b: Address = env.storage().instance().get(&DataKey::TokenB).unwrap();
        let lp_token_addr: Address = env.storage().instance().get(&DataKey::LpToken).unwrap();

        let reserve_a: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ReserveA)
            .unwrap_or(0);
        let reserve_b: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ReserveB)
            .unwrap_or(0);

        let lp_client = lp_token::Client::new(&env, &lp_token_addr);
        let total_supply = lp_client.total_supply();

        if total_supply == 0 {
            panic!("pool is empty");
        }

        // Proportional withdrawal
        let amount_a = lp_amount * reserve_a / total_supply;
        let amount_b = lp_amount * reserve_b / total_supply;

        if amount_a < min_a {
            panic!("slippage: amount_a below min_a");
        }
        if amount_b < min_b {
            panic!("slippage: amount_b below min_b");
        }

        // Burn LP tokens from provider
        lp_client.burn(&provider, &lp_amount);

        // Transfer tokens back to provider
        let amm_addr = env.current_contract_address();
        let ta_client = token::Client::new(&env, &token_a);
        let tb_client = token::Client::new(&env, &token_b);
        ta_client.transfer(&amm_addr, &provider, &amount_a);
        tb_client.transfer(&amm_addr, &provider, &amount_b);

        // Update reserves
        env.storage()
            .instance()
            .set(&DataKey::ReserveA, &(reserve_a - amount_a));
        env.storage()
            .instance()
            .set(&DataKey::ReserveB, &(reserve_b - amount_b));

        env.events().publish(
            (symbol_short!("amm"), symbol_short!("rem_liq")),
            (provider, amount_a, amount_b, lp_amount),
        );

        (amount_a, amount_b)
    }

    // ── Swap ─────────────────────────────────────────────────────────────────────

    /// Swap tokens using the constant product formula with 0.3% fee.
    /// `token_in` must be either TokenA or TokenB address.
    /// `min_amount_out`: minimum output expected (slippage guard).
    /// Returns the amount of the output token received.
    pub fn swap(
        env: Env,
        user: Address,
        token_in: Address,
        amount_in: i128,
        min_amount_out: i128,
    ) -> i128 {
        user.require_auth();

        if amount_in <= 0 {
            panic!("amount_in must be positive");
        }

        let token_a: Address = env.storage().instance().get(&DataKey::TokenA).unwrap();
        let token_b: Address = env.storage().instance().get(&DataKey::TokenB).unwrap();

        let reserve_a: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ReserveA)
            .unwrap_or(0);
        let reserve_b: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ReserveB)
            .unwrap_or(0);

        if reserve_a == 0 || reserve_b == 0 {
            panic!("pool has no liquidity");
        }

        // Determine direction
        let is_a_to_b = token_in == token_a;
        if !is_a_to_b && token_in != token_b {
            panic!("token_in is not TokenA or TokenB");
        }

        let (reserve_in, reserve_out, token_out) = if is_a_to_b {
            (reserve_a, reserve_b, token_b.clone())
        } else {
            (reserve_b, reserve_a, token_a.clone())
        };

        // Constant product formula with 0.3% fee (multiply by 997/1000)
        let amount_in_with_fee = amount_in * 997;
        let amount_out =
            amount_in_with_fee * reserve_out / (reserve_in * 1000 + amount_in_with_fee);

        if amount_out < min_amount_out {
            panic!("slippage: amount_out below min_amount_out");
        }
        if amount_out <= 0 {
            panic!("zero output");
        }

        // Transfer token_in from user to AMM
        let amm_addr = env.current_contract_address();
        let tin_client = token::Client::new(&env, &token_in);
        tin_client.transfer(&user, &amm_addr, &amount_in);

        // Transfer token_out from AMM to user
        let tout_client = token::Client::new(&env, &token_out);
        tout_client.transfer(&amm_addr, &user, &amount_out);

        // Update reserves
        if is_a_to_b {
            env.storage()
                .instance()
                .set(&DataKey::ReserveA, &(reserve_a + amount_in));
            env.storage()
                .instance()
                .set(&DataKey::ReserveB, &(reserve_b - amount_out));
        } else {
            env.storage()
                .instance()
                .set(&DataKey::ReserveA, &(reserve_a - amount_out));
            env.storage()
                .instance()
                .set(&DataKey::ReserveB, &(reserve_b + amount_in));
        }

        env.events().publish(
            (symbol_short!("amm"), symbol_short!("swap")),
            (user, token_in, amount_in, amount_out),
        );

        amount_out
    }

    // ── Read-only ─────────────────────────────────────────────────────────────────

    /// Returns (reserve_a, reserve_b).
    pub fn get_reserves(env: Env) -> (i128, i128) {
        let reserve_a: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ReserveA)
            .unwrap_or(0);
        let reserve_b: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ReserveB)
            .unwrap_or(0);
        (reserve_a, reserve_b)
    }

    /// Returns the expected output for a given input (preview only, no slippage guard).
    pub fn get_price(env: Env, token_in: Address, amount_in: i128) -> i128 {
        if amount_in <= 0 {
            return 0;
        }

        let token_a: Address = env.storage().instance().get(&DataKey::TokenA).unwrap();
        let token_b: Address = env.storage().instance().get(&DataKey::TokenB).unwrap();

        let reserve_a: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ReserveA)
            .unwrap_or(0);
        let reserve_b: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ReserveB)
            .unwrap_or(0);

        if reserve_a == 0 || reserve_b == 0 {
            return 0;
        }

        let (reserve_in, reserve_out) = if token_in == token_a {
            (reserve_a, reserve_b)
        } else if token_in == token_b {
            (reserve_b, reserve_a)
        } else {
            return 0;
        };

        let amount_in_with_fee = amount_in * 997;
        amount_in_with_fee * reserve_out / (reserve_in * 1000 + amount_in_with_fee)
    }

    pub fn get_token_a(env: Env) -> Address {
        env.storage().instance().get(&DataKey::TokenA).unwrap()
    }

    pub fn get_token_b(env: Env) -> Address {
        env.storage().instance().get(&DataKey::TokenB).unwrap()
    }

    pub fn get_lp_token(env: Env) -> Address {
        env.storage().instance().get(&DataKey::LpToken).unwrap()
    }
}

// ── Integer square root (Babylonian algorithm, no floating point) ──────────────

fn integer_sqrt(n: i128) -> i128 {
    if n <= 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}
