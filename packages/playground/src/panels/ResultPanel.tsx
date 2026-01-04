interface ResultPanelProps {
  runtimeResult: string | null;
  typeInfo: string | null;
  error: string | null;
  errorPhase: 'parse' | 'compile' | 'runtime' | null;
}

export function ResultPanel({ runtimeResult, typeInfo, error, errorPhase }: ResultPanelProps) {
  if (error && (errorPhase === 'parse' || errorPhase === 'compile')) {
    return (
      <div className="h-full w-full bg-gray-900 p-4 overflow-auto">
        <div className="text-red-400 font-mono text-sm whitespace-pre-wrap">
          <div className="font-bold mb-2">Error:</div>
          {error}
        </div>
      </div>
    );
  }

  if (!runtimeResult && !typeInfo) {
    return (
      <div className="h-full w-full bg-gray-900 p-4 text-gray-500 italic">
        Enter code in the editor to see results
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-gray-900 p-4 overflow-auto">
      <div className="space-y-4">
        <section>
          <h3 className="text-gray-400 text-sm font-semibold mb-2 uppercase tracking-wide">
            Runtime Result
          </h3>
          <div className="font-mono text-sm text-green-400 bg-gray-800 p-3 rounded">
            {runtimeResult || '(no result)'}
          </div>
        </section>

        <section>
          <h3 className="text-gray-400 text-sm font-semibold mb-2 uppercase tracking-wide">
            Inferred Type
          </h3>
          <div className="font-mono text-sm text-blue-400 bg-gray-800 p-3 rounded whitespace-pre-wrap">
            {typeInfo || '(no type info)'}
          </div>
        </section>
      </div>
    </div>
  );
}
