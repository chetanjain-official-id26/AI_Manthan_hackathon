package com.expenseflow.policy.engine;

import com.expenseflow.policy.engine.PolicyModel.LineInput;
import com.expenseflow.policy.engine.PolicyModel.PolicyInput;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Evaluation state: the input plus the lines of this claim already processed (for in-claim checks). */
public final class EvalContext {
    private final PolicyInput input;
    private final List<LineInput> earlierLines = new ArrayList<>();

    EvalContext(PolicyInput input) {
        this.input = input;
    }

    public PolicyInput input() {
        return input;
    }

    /** Lines of the current claim that come before the line being evaluated (by date, then id). */
    public List<LineInput> earlierLines() {
        return Collections.unmodifiableList(earlierLines);
    }

    void markProcessed(LineInput line) {
        earlierLines.add(line);
    }
}
