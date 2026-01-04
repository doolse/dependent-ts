import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';

interface EditorPanelProps {
  value: string;
  onChange: (value: string) => void;
}

export function EditorPanel({ value, onChange }: EditorPanelProps) {
  return (
    <div className="h-full w-full bg-gray-900">
      <CodeMirror
        value={value}
        height="100%"
        theme="dark"
        extensions={[javascript({ jsx: true, typescript: true })]}
        onChange={onChange}
        className="h-full"
      />
    </div>
  );
}
