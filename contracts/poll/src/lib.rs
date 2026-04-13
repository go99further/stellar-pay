#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env, Map, String, Vec,
};

/// Storage keys for the poll contract
#[contracttype]
pub enum DataKey {
    Admin,
    Question,
    Options,
    Votes,
    Voters,
    TotalVotes,
    PollActive,
}

#[contract]
pub struct PollContract;

#[contractimpl]
impl PollContract {
    /// Initialize the contract — sets the caller as admin.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::PollActive, &false);
    }

    /// Create a new poll (admin only). Supports 2–4 options.
    pub fn create_poll(env: Env, question: String, options: Vec<String>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        if options.len() < 2 || options.len() > 4 {
            panic!("need 2-4 options");
        }

        let mut votes: Map<u32, u32> = Map::new(&env);
        for i in 0..options.len() {
            votes.set(i as u32, 0);
        }
        let empty_voters: Map<Address, u32> = Map::new(&env);

        env.storage().instance().set(&DataKey::Question, &question);
        env.storage().instance().set(&DataKey::Options, &options);
        env.storage().instance().set(&DataKey::Votes, &votes);
        env.storage().instance().set(&DataKey::Voters, &empty_voters);
        env.storage().instance().set(&DataKey::TotalVotes, &0u32);
        env.storage().instance().set(&DataKey::PollActive, &true);

        env.events().publish(
            (symbol_short!("poll"), symbol_short!("created")),
            question,
        );
    }

    /// Cast a vote. Each address can vote exactly once.
    pub fn vote(env: Env, voter: Address, option_index: u32) {
        voter.require_auth();

        let active: bool = env.storage().instance()
            .get(&DataKey::PollActive).unwrap_or(false);
        if !active {
            panic!("no active poll");
        }

        let options: Vec<String> = env.storage().instance()
            .get(&DataKey::Options).unwrap();
        if option_index >= options.len() {
            panic!("invalid option");
        }

        let mut voters: Map<Address, u32> = env.storage().instance()
            .get(&DataKey::Voters).unwrap();
        if voters.contains_key(voter.clone()) {
            panic!("already voted");
        }

        let mut votes: Map<u32, u32> = env.storage().instance()
            .get(&DataKey::Votes).unwrap();
        let current = votes.get(option_index).unwrap_or(0);
        votes.set(option_index, current + 1);
        voters.set(voter.clone(), option_index);

        let total: u32 = env.storage().instance()
            .get(&DataKey::TotalVotes).unwrap_or(0);

        env.storage().instance().set(&DataKey::Votes, &votes);
        env.storage().instance().set(&DataKey::Voters, &voters);
        env.storage().instance().set(&DataKey::TotalVotes, &(total + 1));

        env.events().publish(
            (symbol_short!("poll"), symbol_short!("vote")),
            (voter, option_index, total + 1),
        );
    }

    // ── Read-only functions ──

    pub fn get_question(env: Env) -> String {
        env.storage().instance().get(&DataKey::Question)
            .unwrap_or(String::from_str(&env, "No poll active"))
    }

    pub fn get_options(env: Env) -> Vec<String> {
        env.storage().instance().get(&DataKey::Options)
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_votes(env: Env) -> Map<u32, u32> {
        env.storage().instance().get(&DataKey::Votes)
            .unwrap_or(Map::new(&env))
    }

    pub fn get_total_votes(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::TotalVotes)
            .unwrap_or(0)
    }

    pub fn has_voted(env: Env, voter: Address) -> bool {
        let voters: Map<Address, u32> = env.storage().instance()
            .get(&DataKey::Voters)
            .unwrap_or(Map::new(&env));
        voters.contains_key(voter)
    }

    pub fn is_active(env: Env) -> bool {
        env.storage().instance()
            .get(&DataKey::PollActive)
            .unwrap_or(false)
    }

    /// Admin can close the poll.
    pub fn close_poll(env: Env) {
        let admin: Address = env.storage().instance()
            .get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::PollActive, &false);

        let total: u32 = env.storage().instance()
            .get(&DataKey::TotalVotes).unwrap_or(0);

        env.events().publish(
            (symbol_short!("poll"), symbol_short!("closed")),
            total,
        );
    }
}
