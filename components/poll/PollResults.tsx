"use client";

interface PollResultsProps {
  options: string[];
  votes: Map<number, number>;
  totalVotes: number;
}

const BAR_COLORS = [
  "from-blue-500 to-blue-400",
  "from-violet-500 to-violet-400",
  "from-emerald-500 to-emerald-400",
  "from-amber-500 to-amber-400",
];

export default function PollResults({ options, votes, totalVotes }: PollResultsProps) {
  if (options.length === 0) return null;

  return (
    <div className="p-6 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/10 shadow-2xl">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Live Results</h3>
        <span className="text-xs text-slate-400 bg-white/5 px-2 py-1 rounded-lg">
          {totalVotes} total votes
        </span>
      </div>

      <div className="space-y-4">
        {options.map((option, index) => {
          const count = votes.get(index) || 0;
          const percentage = totalVotes > 0 ? (count / totalVotes) * 100 : 0;

          return (
            <div key={index}>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-slate-300 font-medium">{option}</span>
                <span className="text-slate-400">
                  {count} ({percentage.toFixed(1)}%)
                </span>
              </div>
              <div className="h-3 bg-white/5 rounded-full overflow-hidden">
                <div
                  className={`h-full bg-gradient-to-r ${BAR_COLORS[index % BAR_COLORS.length]} rounded-full transition-all duration-700 ease-out`}
                  style={{ width: `${Math.max(percentage, 0.5)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
