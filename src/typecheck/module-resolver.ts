/**
 * Module Resolver - resolves import specifiers to .d.ts files and loads types.
 *
 * Handles:
 * - npm packages: looks in node_modules/@types/<pkg> and node_modules/<pkg>
 * - Relative paths: looks for .d.ts files relative to the source file
 */

import * as fs from "fs";
import * as path from "path";
import { CoreDecl } from "../ast/core-ast";
import { loadDTS } from "../dts-loader/dts-translator";

/**
 * Result of resolving a module.
 */
export interface ResolvedModule {
  /** Path to the .d.ts file */
  dtsPath: string;
  /** Declarations to be processed by the type checker */
  decls: CoreDecl[];
}

/**
 * Module resolver configuration.
 */
export interface ModuleResolverConfig {
  /** Base directory for resolving modules (usually the directory containing the source file) */
  baseDir: string;
}

/**
 * Module resolver that finds and loads .d.ts files.
 */
export class ModuleResolver {
  private baseDir: string;
  private cache: Map<string, ResolvedModule | null> = new Map();
  /** Tracks files currently being loaded to detect circular dependencies */
  private loading: Set<string> = new Set();

  constructor(config: ModuleResolverConfig) {
    this.baseDir = config.baseDir;
  }

  /**
   * Resolve a module specifier to its types.
   * Returns null if the module cannot be resolved.
   */
  resolve(specifier: string): ResolvedModule | null {
    return this.resolveFromDir(specifier, this.baseDir);
  }

  /**
   * Try to find .d.ts in a package directory.
   */
  private tryPackageDir(packageDir: string, subpath: string): ResolvedModule | null {
    if (!fs.existsSync(packageDir)) {
      return null;
    }

    // If there's a subpath, look for it directly
    if (subpath) {
      const subpathCandidates = [
        path.join(packageDir, subpath + ".d.ts"),
        path.join(packageDir, subpath, "index.d.ts"),
      ];

      for (const candidate of subpathCandidates) {
        if (fs.existsSync(candidate)) {
          return this.loadDTSFile(candidate);
        }
      }
      return null;
    }

    // Look for package.json to find the types entry
    const packageJsonPath = path.join(packageDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        const typesEntry = packageJson.types || packageJson.typings;

        if (typesEntry) {
          const typesPath = path.join(packageDir, typesEntry);
          if (fs.existsSync(typesPath)) {
            return this.loadDTSFile(typesPath);
          }
        }
      } catch {
        // Ignore JSON parse errors
      }
    }

    // Fall back to index.d.ts
    const indexDts = path.join(packageDir, "index.d.ts");
    if (fs.existsSync(indexDts)) {
      return this.loadDTSFile(indexDts);
    }

    return null;
  }

  /**
   * Load and parse a .d.ts file.
   */
  private loadDTSFile(dtsPath: string): ResolvedModule | null {
    // Circular dependency protection
    if (this.loading.has(dtsPath)) {
      // Return empty result to break the cycle
      return {
        dtsPath,
        decls: [],
      };
    }

    this.loading.add(dtsPath);
    try {
      const content = fs.readFileSync(dtsPath, "utf-8");
      const result = loadDTS(content, {
        filePath: dtsPath,
      });

      return {
        dtsPath,
        decls: result.decls,
      };
    } catch (error) {
      // File read or parse error
      return null;
    } finally {
      this.loading.delete(dtsPath);
    }
  }

  /**
   * Resolve a module specifier from a specific directory.
   * This is used for resolving imports within .d.ts files.
   */
  private resolveFromDir(specifier: string, baseDir: string): ResolvedModule | null {
    // Check cache first
    const cacheKey = `${baseDir}:${specifier}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    let result: ResolvedModule | null = null;

    if (specifier.startsWith(".") || specifier.startsWith("/")) {
      // Relative or absolute path - resolve from the given base directory
      result = this.resolveRelativeFromDir(specifier, baseDir);
    } else {
      // npm package - use the standard resolution
      result = this.resolvePackageFromDir(specifier, baseDir);
    }

    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Resolve a relative path import from a specific directory.
   */
  private resolveRelativeFromDir(specifier: string, baseDir: string): ResolvedModule | null {
    const basePath = path.resolve(baseDir, specifier);

    // Try various extensions
    const candidates = [
      basePath + ".d.ts",
      path.join(basePath, "index.d.ts"),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return this.loadDTSFile(candidate);
      }
    }

    return null;
  }

  /**
   * Resolve an npm package import from a specific directory.
   * Builds node_modules paths by walking up from baseDir.
   */
  private resolvePackageFromDir(specifier: string, baseDir: string): ResolvedModule | null {
    // Handle scoped packages and subpaths
    const parts = specifier.split("/");
    let packageName: string;
    let subpath: string;

    if (specifier.startsWith("@")) {
      // Scoped package: @scope/package or @scope/package/subpath
      packageName = parts.slice(0, 2).join("/");
      subpath = parts.slice(2).join("/");
    } else {
      // Regular package: package or package/subpath
      packageName = parts[0];
      subpath = parts.slice(1).join("/");
    }

    // Build node_modules paths by walking up from baseDir
    let dir = baseDir;
    while (true) {
      const nodeModulesPath = path.join(dir, "node_modules");

      // Try @types/<package>
      const typesPath = path.join(nodeModulesPath, "@types", packageName.replace("@", "").replace("/", "__"));
      const typesResult = this.tryPackageDir(typesPath, subpath);
      if (typesResult) return typesResult;

      // Try the package itself (might have bundled types)
      const packagePath = path.join(nodeModulesPath, packageName);
      const packageResult = this.tryPackageDir(packagePath, subpath);
      if (packageResult) return packageResult;

      const parent = path.dirname(dir);
      if (parent === dir) break; // Reached root
      dir = parent;
    }

    return null;
  }

  /**
   * Clear the module cache.
   */
  clearCache(): void {
    this.cache.clear();
  }
}
