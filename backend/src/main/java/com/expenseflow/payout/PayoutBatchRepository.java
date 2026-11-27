package com.expenseflow.payout;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PayoutBatchRepository extends JpaRepository<PayoutBatch, Long> {
    List<PayoutBatch> findAllByOrderByIdDesc();
}
