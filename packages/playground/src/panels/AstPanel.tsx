import CodeMirror from '@uiw/react-codemirror';

interface AstPanelProps {
  ast: string | null;
  error: string | null;
  errorPhase: 'parse' | 'compile' | 'runtime' | null;
}

export function AstPanel({ ast, error, errorPhase }: AstPanelProps) {
  if (errorPhase === 'parse' && error) {
    return (
      <div className="h-full w-full bg-gray-900 p-4 overflow-auto">
        <div className="text-red-400 font-mono text-sm whitespace-pre-wrap">
          <div className="font-bold mb-2">Parse Error:</div>
          {error}
        </div>
      </div>
    );
  }

  if (!ast) {
    return (
      <div className="h-full w-full bg-gray-900 p-4 text-gray-500 italic">
        Enter code in the editor to see the AST
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-gray-900">
      <CodeMirror
        value={ast}
        height="100%"
        theme="dark"
        readOnly
        className="h-full"
      />
    </div>
  );
}
