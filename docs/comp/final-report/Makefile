SHELL := /bin/sh

REPORT := VeriSpecOSLab-final-technical-report
ROOT := ../../..
OUTPUT_DIR := $(ROOT)/output/pdf
BUILD_DIR := build
FIGURE_SOURCES := $(wildcard figures/*.svg)
FIGURE_PDFS := $(patsubst figures/%.svg,$(BUILD_DIR)/figures/%.pdf,$(FIGURE_SOURCES))

.PHONY: all figures clean

all: $(OUTPUT_DIR)/$(REPORT).pdf

figures: $(FIGURE_PDFS)

$(BUILD_DIR)/figures/%.pdf: figures/%.svg
	@mkdir -p $(BUILD_DIR)/figures
	rsvg-convert -f pdf -o $@ $<

$(OUTPUT_DIR)/$(REPORT).pdf: main.tex preamble.tex $(FIGURE_PDFS) $(wildcard frontmatter/*.tex) $(wildcard chapters/*.tex) $(wildcard backmatter/*.tex)
	@mkdir -p $(BUILD_DIR) $(OUTPUT_DIR)
	latexmk -xelatex -interaction=nonstopmode -halt-on-error -outdir=$(BUILD_DIR) main.tex
	cp $(BUILD_DIR)/main.pdf $@

clean:
	latexmk -C -outdir=$(BUILD_DIR) main.tex
	rm -f $(FIGURE_PDFS)
