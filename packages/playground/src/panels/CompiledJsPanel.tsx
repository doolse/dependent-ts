import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';

interface CompiledJsPanelProps {
  compiledJs: string | null;
  error: string | null;
  errorPhase: 'parse' | 'compile' | 'runtime' | null;
}

export function CompiledJsPanel({ compiledJs, error, errorPhase }: CompiledJsPanelProps) {
  if ((errorPhase === 'parse' || errorPhase === 'compile') && error) {
    return (
      <div className="h-full w-full bg-gray-900 p-4 overflow-auto">
        <div className="text-red-400 font-mono text-sm whitespace-pre-wrap">
          <div className="font-bold mb-2">
            {errorPhase === 'parse' ? 'Parse Error:' : 'Compile Error:'}
          </div>
          {error}
        </div>
      </div>
    );
  }

  if (!compiledJs) {
    return (
      <div className="h-full w-full bg-gray-900 p-4 text-gray-500 italic">
        Enter code in the editor to see compiled JavaScript
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-gray-900">
      <CodeMirror
        value={compiledJs}
        height="100%"
        theme="dark"
        extensions={[javascript()]}
        readOnly
        className="h-full"
      />
    </div>
  );
}
