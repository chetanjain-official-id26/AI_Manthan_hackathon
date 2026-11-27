package com.expenseflow.claim;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ClaimCommentRepository extends JpaRepository<ClaimComment, Long> {
    List<ClaimComment> findByClaimIdOrderByIdAsc(Long claimId);
}
