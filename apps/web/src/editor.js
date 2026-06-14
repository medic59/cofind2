// TipTap editor bundle entry. esbuild bundles this (with its npm deps) into a
// single self-hosted IIFE (dist/vendor/editor.js) that exposes the building
// blocks on window.CofindRichText. app.js composes the actual editor + toolbar.
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";

window.CofindRichText = { Editor, StarterKit, Link, Placeholder };
