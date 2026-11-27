package com.expenseflow.payout;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PayoutItemRepository extends JpaRepository<PayoutItem, Long> {
    List<PayoutItem> findByBatchIdOrderByIdAsc(Long batchId);
}
