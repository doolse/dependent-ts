import { useState, useCallback } from 'react';
import { Layout, Model, TabNode, IJsonModel } from 'flexlayout-react';
import 'flexlayout-react/style/dark.css';
import { EditorPanel } from './panels/EditorPanel';
import { AstPanel } from './panels/AstPanel';
import { CompiledJsPanel } from './panels/CompiledJsPanel';
import { ResultPanel } from './panels/ResultPanel';
import { useCompilation } from './hooks/useCompilation';

const DEFAULT_CODE = `const add = (a: number, b: number) => a + b;
const result = add(1, 2);
result * 10`;

const layoutJson: IJsonModel = {
  global: {
    tabEnableClose: false,
    tabEnableRename: false,
  },
  borders: [],
  layout: {
    type: 'row',
    weight: 100,
    children: [
      {
        type: 'row',
        weight: 50,
        children: [
          {
            type: 'tabset',
            weight: 50,
            children: [
              {
                type: 'tab',
                name: 'Editor',
                component: 'editor',
              },
            ],
          },
          {
            type: 'tabset',
            weight: 50,
            children: [
              {
                type: 'tab',
                name: 'AST',
                component: 'ast',
              },
            ],
          },
        ],
      },
      {
        type: 'row',
        weight: 50,
        children: [
          {
            type: 'tabset',
            weight: 50,
            children: [
              {
                type: 'tab',
                name: 'Compiled JS',
                component: 'compiled',
              },
            ],
          },
          {
            type: 'tabset',
            weight: 50,
            children: [
              {
                type: 'tab',
                name: 'Result',
                component: 'result',
              },
            ],
          },
        ],
      },
    ],
  },
};

export default function App() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [model] = useState(() => Model.fromJson(layoutJson));
  const compilation = useCompilation(code, 300);

  const factory = useCallback(
    (node: TabNode) => {
      const component = node.getComponent();

      switch (component) {
        case 'editor':
          return <EditorPanel value={code} onChange={setCode} />;
        case 'ast':
          return (
            <AstPanel
              ast={compilation.ast}
              error={compilation.error}
              errorPhase={compilation.errorPhase}
            />
          );
        case 'compiled':
          return (
            <CompiledJsPanel
              compiledJs={compilation.compiledJs}
              error={compilation.error}
              errorPhase={compilation.errorPhase}
            />
          );
        case 'result':
          return (
            <ResultPanel
              runtimeResult={compilation.runtimeResult}
              typeInfo={compilation.typeInfo}
              error={compilation.error}
              errorPhase={compilation.errorPhase}
            />
          );
        default:
          return <div>Unknown component: {component}</div>;
      }
    },
    [code, compilation]
  );

  return (
    <div className="h-screen w-screen bg-gray-900">
      <Layout model={model} factory={factory} />
    </div>
  );
}
