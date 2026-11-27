package com.expenseflow.approval;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ApprovalThresholdRepository extends JpaRepository<ApprovalThreshold, Long> {

    List<ApprovalThreshold> findByActiveTrueOrderBySeqAsc();

    Optional<ApprovalThreshold> findFirstByLevelAndActiveTrue(String level);

    List<ApprovalThreshold> findByLevelOrderByVersionDesc(String level);
}
