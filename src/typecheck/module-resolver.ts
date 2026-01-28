/**
 * Module Resolver - resolves import specifiers to .d.ts files and loads types.
 *
 * Handles:
 * - npm packages: looks in node_modules/@types/<pkg> and node_modules/<pkg>
 * - Relative paths: looks for .d.ts files relative to the source file
 */

import * as fs from "fs";
import * as path from "path";
import { Type } from "../types/types";
import { loadDTS, DTSLoadResult } from "../dts-loader/dts-translator";

/**
 * Result of resolving a module.
 */
export interface ResolvedModule {
  /** Path to the .d.ts file */
  dtsPath: string;
  /** Loaded type exports */
  types: Map<string, Type>;
  /** Loaded value exports */
  values: Map<string, Type>;
}

/**
 * Module resolver configuration.
 */
export interface ModuleResolverConfig {
  /** Base directory for resolving modules (usually the directory containing the source file) */
  baseDir: string;
  /** Additional directories to search for node_modules */
  nodeModulesPaths?: string[];
}

/**
 * Module resolver that finds and loads .d.ts files.
 */
export class ModuleResolver {
  private baseDir: string;
  private nodeModulesPaths: string[];
  private cache: Map<string, ResolvedModule | null> = new Map();

  constructor(config: ModuleResolverConfig) {
    this.baseDir = config.baseDir;

    // Build node_modules paths by walking up the directory tree (Node.js style)
    if (config.nodeModulesPaths) {
      this.nodeModulesPaths = config.nodeModulesPaths;
    } else {
      this.nodeModulesPaths = [];
      let dir = config.baseDir;
      while (true) {
        const nmPath = path.join(dir, "node_modules");
        this.nodeModulesPaths.push(nmPath);
        const parent = path.dirname(dir);
        if (parent === dir) break; // Reached root
        dir = parent;
      }
    }
  }

  /**
   * Resolve a module specifier to its types.
   * Returns null if the module cannot be resolved.
   */
  resolve(specifier: string): ResolvedModule | null {
    // Check cache first
    const cacheKey = `${this.baseDir}:${specifier}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    let result: ResolvedModule | null = null;

    if (specifier.startsWith(".") || specifier.startsWith("/")) {
      // Relative or absolute path
      result = this.resolveRelative(specifier);
    } else {
      // npm package
      result = this.resolvePackage(specifier);
    }

    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Resolve a relative path import.
   */
  private resolveRelative(specifier: string): ResolvedModule | null {
    const basePath = path.resolve(this.baseDir, specifier);

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
   * Resolve an npm package import.
   */
  private resolvePackage(specifier: string): ResolvedModule | null {
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

    for (const nodeModulesPath of this.nodeModulesPaths) {
      // Try @types/<package>
      const typesPath = path.join(nodeModulesPath, "@types", packageName.replace("@", "").replace("/", "__"));
      const typesResult = this.tryPackageDir(typesPath, subpath);
      if (typesResult) return typesResult;

      // Try the package itself (might have bundled types)
      const packagePath = path.join(nodeModulesPath, packageName);
      const packageResult = this.tryPackageDir(packagePath, subpath);
      if (packageResult) return packageResult;
    }

    return null;
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
    try {
      const content = fs.readFileSync(dtsPath, "utf-8");
      const result = loadDTS(content);

      return {
        dtsPath,
        types: result.types,
        values: result.values,
      };
    } catch (error) {
      // File read or parse error
      return null;
    }
  }

  /**
   * Clear the module cache.
   */
  clearCache(): void {
    this.cache.clear();
  }
}
